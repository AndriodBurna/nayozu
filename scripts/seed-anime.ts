import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// AniList GraphQL endpoint
const ANILIST_API_URL = 'https://graphql.anilist.co';

// GraphQL query to fetch popular anime with genre collection
const GET_POPULAR_ANIME = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        currentPage
        lastPage
        hasNextPage
      }
      media(type: ANIME, sort: [POPULARITY_DESC], isAdult: false) {
        id
        title {
          romaji
          english
        }
        description
        coverImage {
          large
          extraLarge
        }
        bannerImage
        genres
        episodes
        status
        season
        seasonYear
        format
        averageScore
        popularity
      }
    }
  }
`;

// GraphQL query to fetch all genres
const GET_ALL_GENRES = `
  query {
    GenreCollection {
      nodes {
        id
        name
      }
    }
  }
`;

// Delay function to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch data from AniList API
async function fetchAniListData(page: number, perPage: number = 50) {
  try {
    const response = await fetch(ANILIST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: GET_POPULAR_ANIME,
        variables: {
          page,
          perPage
        }
      })
    });

    if (!response.ok) {
      throw new Error(`AniList API error: ${response.status}`);
    }

    const json = await response.json();

    if (json.errors) {
      throw new Error(`GraphQL errors: ${json.errors.map((e: any) => e.message).join(', ')}`);
    }

    return json.data.Page;
  } catch (error) {
    console.error(`Error fetching page ${page}:`, error);
    throw error;
  }
}

// Fetch all genres from AniList
async function fetchAllGenres() {
  try {
    const response = await fetch(ANILIST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: GET_ALL_GENRES
      })
    });

    if (!response.ok) {
      throw new Error(`AniList API error: ${response.status}`);
    }

    const json = await response.json();

    if (json.errors) {
      throw new Error(`GraphQL errors: ${json.errors.map((e: any) => e.message).join(', ')}`);
    }

    return json.data.GenreCollection.nodes;
  } catch (error) {
    console.error(`Error fetching genres:`, error);
    throw error;
  }
}

// Process and clean description (remove HTML tags)
function cleanDescription(description: string | null): string | null {
  if (!description) return null;
  // Remove HTML tags
  return description.replace(/<[^>]*>/g, '').trim();
}

// Generate slug from title, ID and media type to ensure uniqueness across types
function generateSlug(title: string, id: number | string, mediaType: string): string {
  // Clean title for slug
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${cleanTitle}-${mediaType}-${id}`;
}

// Upsert genres and return mapping of genre name to genre UUID
async function upsertGenres(genreNames: string[]): Promise<Map<string, string>> {
  const genreNameToIdMap = new Map<string, string>();

  // Process genres in batches to avoid too many parameters
  const batchSize = 20;
  for (let i = 0; i < genreNames.length; i += batchSize) {
    const batch = genreNames.slice(i, i + batchSize);

    // Prepare data for upsert
    const genreRecords = batch.map(genreName => ({
      name: genreName
    }));

    // Upsert genres
    const { data, error } = await supabase
      .from('genres')
      .upsert(genreRecords, {
        onConflict: 'name'
      })
      .select('id, name');

    if (error) {
      console.error('Error upserting genres batch:', error);
      throw error;
    }

    // Build mapping from name to id
    data.forEach(genre => {
      genreNameToIdMap.set(genre.name, genre.id);
    });
  }

  return genreNameToIdMap;
}

// Upsert anime data
async function upsertAnime(animeData: any, genreNameToIdMap: Map<string, string>) {
  try {
    // Prepare anime record
    const animeRecord = {
      external_id: animeData.id.toString(), // Store as text to match existing tables
      title_romaji: animeData.title.romaji || '',
      title_english: animeData.title.english || null,
      slug: generateSlug(animeData.title.romaji || '', animeData.id, 'anime'),
      synopsis: animeData.description || null,
      cover_image_url: animeData.coverImage?.large || null,
      banner_image_url: animeData.bannerImage || null,
      episodes: animeData.episodes || null,
      status: animeData.status || null,
      season: animeData.season || null,
      season_year: animeData.seasonYear || null,
      format: animeData.format || null,
      average_score: animeData.averageScore || null,
      popularity: animeData.popularity || null,
      media_type: 'anime' // Always anime for this script
    };

    // Upsert anime
    const { data: anime, error: animeError } = await supabase
      .from('anime')
      .upsert(animeRecord, {
        onConflict: 'media_type,external_id'
      })
      .select('id, external_id')
      .single();

    if (animeError) {
      console.error(`Error upserting anime ${animeData.id}:`, animeError);
      throw animeError;
    }

    // Process genres
    if (animeData.genres && animeData.genres.length > 0) {
      const genrePromises = animeData.genres.map(async (genreName: string) => {
        // Look up genre by name directly from our map
        const genreId = genreNameToIdMap.get(genreName);
        return genreId || null;
      });

      const genreIds = await Promise.all(genrePromises);
      const validGenreIds = genreIds.filter((id): id is string => id !== null);

      // Create anime-genre relationships
      if (validGenreIds.length > 0) {
        const animeGenreRecords = validGenreIds.map(genreId => ({
          anime_id: anime.id,
          genre_id: genreId
        }));

        const { error: animeGenreError } = await supabase
          .from('anime_genres')
          .upsert(animeGenreRecords, {
            onConflict: 'anime_id,genre_id'
          });

        if (animeGenreError) {
          console.error(`Error creating anime-genre relationships for anime ${animeData.id}:`, animeGenreError);
          // Don't throw here as the main anime record was saved successfully
        }
      }
    }

    return anime;
  } catch (error) {
    console.error(`Error processing anime ${animeData.id}:`, error);
    throw error;
  }
}

// Main seeding function
async function seedAnime() {
  console.log('Starting anime seeding from AniList...');

  let page = 1;
  let hasNextPage = true;
  const perPage = 50; // AniList recommends max 50 per page
  let totalProcessed = 0;

  // First, fetch all genres from AniList
  console.log('Fetching all genres from AniList...');
  let allGenres;
  try {
    allGenres = await fetchAllGenres();
  } catch (error) {
    console.error('Failed to fetch genres:', error);
    process.exit(1);
  }

  const genreNames = allGenres.map((genre: any) => genre.name);
  console.log(`Found ${genreNames.length} unique genres from AniList`);

  // Upsert all genres first
  console.log('Upserting genres...');
  const genreNameToIdMap = await upsertGenres(genreNames);
  console.log(`Upserted ${genreNameToIdMap.size} genres`);

  // Now process all pages
  while (hasNextPage) {
    console.log(`Fetching page ${page}...`);

    let pageData;
    try {
      pageData = await fetchAniListData(page, perPage);
    } catch (error) {
      console.error(`Failed to fetch page ${page}:`, error);
      // Wait longer before retrying
      await delay(5000);
      continue; // Retry same page
    }

    // Process each anime in the page
    const animePromises = pageData.media.map(async (anime: any) => {
      try {
        await upsertAnime(anime, genreNameToIdMap);
        return true;
      } catch (error) {
        console.error(`Failed to process anime ${anime.id}:`, error);
        return false;
      }
    });

    const results = await Promise.all(animePromises);
    const successful = results.filter(r => r === true).length;
    totalProcessed += successful;

    console.log(`Page ${page}: Processed ${successful}/${pageData.media.length} anime successfully`);

    // Update pagination info
    hasNextPage = pageData.pageInfo.hasNextPage;
    page++;

    // Respect rate limits - delay between requests
    if (hasNextPage) {
      console.log('Waiting 2 seconds before next request...');
      await delay(2000);
    }
  }

  console.log(`Seeding completed! Total anime processed: ${totalProcessed}`);
}

// Run the seeding function
seedAnime()
  .then(() => {
    console.log('Seeding finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });