/**
 * Unified Seeding Script for Anime & Manga
 * Usage: node scripts/seed.cjs [anime|manga|all]
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load environment variables strictly from .env.local
function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env.local file not found at ' + envPath);
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('Error: Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
  process.exit(1);
}

if (!supabaseKey) {
  console.error('Error: Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Initialize Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const ANILIST_API_URL = 'https://graphql.anilist.co';
const TARGET_ITEMS = 2000;
const PER_PAGE = 50;
const MAX_PAGES = Math.ceil(TARGET_ITEMS / PER_PAGE); // 40 pages

const GET_MEDIA_QUERY = `
  query ($page: Int, $perPage: Int, $type: MediaType) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        currentPage
        lastPage
        hasNextPage
      }
      media(type: $type, sort: [POPULARITY_DESC], isAdult: false) {
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
        chapters
        volumes
        status
        season
        seasonYear
        startDate {
          year
        }
        countryOfOrigin
        format
        averageScore
        popularity
        trailer {
          id
          site
        }
        externalLinks {
          site
          url
          type
          language
        }
      }
    }
  }
`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanDescription(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return cleaned || null;
}

function generateSlug(title, id, mediaType) {
  const cleanTitle = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
  return `${cleanTitle}-${mediaType}-${id}`;
}

async function fetchAniListPage(page, perPage, mediaType, retryCount = 0) {
  const aniListType = mediaType.toUpperCase(); // 'ANIME' or 'MANGA'
  try {
    const response = await fetch(ANILIST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: GET_MEDIA_QUERY,
        variables: {
          page,
          perPage,
          type: aniListType,
        },
      }),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      console.warn(`Rate limited by AniList. Waiting ${retryAfter} seconds...`);
      await delay(retryAfter * 1000);
      return fetchAniListPage(page, perPage, mediaType, retryCount + 1);
    }

    if (!response.ok) {
      throw new Error(`AniList API responded with status ${response.status}`);
    }

    const json = await response.json();
    if (json.errors) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`);
    }

    return json.data.Page;
  } catch (err) {
    if (retryCount < 3) {
      console.warn(`Error on page ${page} (${err.message}). Retrying in 5s...`);
      await delay(5000);
      return fetchAniListPage(page, perPage, mediaType, retryCount + 1);
    }
    throw err;
  }
}

async function loadGenreCache() {
  const { data, error } = await supabase.from('genres').select('id, name');
  if (error) throw error;
  const map = new Map();
  for (const g of data || []) {
    map.set(g.name, g.id);
  }
  return map;
}

async function getOrCreateGenreId(genreName, genreCache) {
  if (genreCache.has(genreName)) {
    return genreCache.get(genreName);
  }
  const { data, error } = await supabase
    .from('genres')
    .upsert({ name: genreName }, { onConflict: 'name' })
    .select('id, name')
    .single();
  if (error) {
    console.error(`Failed to upsert genre ${genreName}:`, error.message);
    return null;
  }
  genreCache.set(data.name, data.id);
  return data.id;
}

async function upsertMediaItem(item, mediaType, genreCache) {
  const record = {
    external_id: String(item.id),
    title_romaji: item.title?.romaji || item.title?.english || '',
    title_english: item.title?.english || null,
    slug: generateSlug(item.title?.romaji || item.title?.english, item.id, mediaType),
    synopsis: cleanDescription(item.description),
    cover_image_url: item.coverImage?.extraLarge || item.coverImage?.large || null,
    banner_image_url: item.bannerImage || null,
    episodes: mediaType === 'anime' ? (item.episodes || null) : null,
    chapters: mediaType === 'manga' ? (item.chapters || null) : null,
    volumes: mediaType === 'manga' ? (item.volumes || null) : null,
    status: item.status || null,
    season: mediaType === 'anime' ? (item.season || null) : null,
    season_year: item.seasonYear || item.startDate?.year || null,
    format: item.format || null,
    country: item.countryOfOrigin || null,
    average_score: item.averageScore || null,
    popularity: item.popularity || null,
    media_type: mediaType,
    trailer_site: item.trailer?.site || null,
    trailer_id: item.trailer?.id ? String(item.trailer.id) : null,
    external_links: item.externalLinks && item.externalLinks.length > 0
      ? item.externalLinks.map((l) => ({
          site: l.site,
          url: l.url,
          type: l.type || null,
          language: l.language || null,
        }))
      : null,
  };

  const { data: mediaRow, error: mediaError } = await supabase
    .from('anime')
    .upsert(record, { onConflict: 'media_type,external_id' })
    .select('id')
    .single();

  if (mediaError) {
    if (mediaError.message && mediaError.message.includes('schema cache')) {
      console.error('\nDatabase schema error:', mediaError.message);
      console.error('Please make sure you have executed the SQL migration in the Supabase SQL editor to add the new columns (chapters, volumes, country, external_links, trailer_site, trailer_id).\n');
      process.exit(1);
    }
    console.error(`Error upserting ${mediaType} ${item.id}:`, mediaError.message);
    throw mediaError;
  }

  // Handle genres
  if (item.genres && item.genres.length > 0) {
    const genreIds = [];
    for (const gName of item.genres) {
      const gid = await getOrCreateGenreId(gName, genreCache);
      if (gid) genreIds.push(gid);
    }

    if (genreIds.length > 0) {
      const links = genreIds.map((gid) => ({
        anime_id: mediaRow.id,
        genre_id: gid,
      }));
      const { error: linkErr } = await supabase
        .from('anime_genres')
        .upsert(links, { onConflict: 'anime_id,genre_id' });
      if (linkErr) {
        console.error(`Error linking genres for ${mediaType} ${item.id}:`, linkErr.message);
      }
    }
  }

  return true;
}

async function seedMediaType(mediaType) {
  console.log(`\n========================================`);
  console.log(`Starting ${mediaType.toUpperCase()} seeding (target: ~${TARGET_ITEMS})...`);
  console.log(`========================================`);

  const genreCache = await loadGenreCache();
  console.log(`Loaded ${genreCache.size} existing genres from database.`);

  let page = 1;
  let hasNextPage = true;
  let totalProcessed = 0;

  while (hasNextPage && page <= MAX_PAGES) {
    process.stdout.write(`Fetching ${mediaType} page ${page}/${MAX_PAGES}... `);

    let pageData;
    try {
      pageData = await fetchAniListPage(page, PER_PAGE, mediaType);
    } catch (err) {
      console.error(`\nFailed to fetch page ${page}:`, err.message);
      break;
    }

    const items = pageData.media || [];
    let pageSuccess = 0;

    for (const item of items) {
      try {
        await upsertMediaItem(item, mediaType, genreCache);
        pageSuccess++;
      } catch (err) {
        console.error(`Failed item ${item.id}: ${err.message}`);
      }
    }

    totalProcessed += pageSuccess;
    console.log(`Upserted ${pageSuccess}/${items.length} items. (Total: ${totalProcessed})`);

    hasNextPage = pageData.pageInfo?.hasNextPage && page < MAX_PAGES;
    page++;

    if (hasNextPage) {
      // Delay 700ms to stay within AniList rate limits (max 90/min)
      await delay(700);
    }
  }

  console.log(`\nFinished ${mediaType} seeding. Processed ${totalProcessed} records.`);
  return totalProcessed;
}

async function reportFinalCounts() {
  console.log('\n========================================');
  console.log('Final counts per media_type:');
  console.log('========================================');

  const { data: animeCount, error: animeErr } = await supabase
    .from('anime')
    .select('*', { count: 'exact', head: true })
    .eq('media_type', 'anime');

  const { data: mangaCount, error: mangaErr } = await supabase
    .from('anime')
    .select('*', { count: 'exact', head: true })
    .eq('media_type', 'manga');

  if (animeErr) console.error('Error counting anime:', animeErr.message);
  else console.log(`  - anime: ${animeCount ? animeCount.length : 'N/A'}`);

  // Using count from PostgREST response headers
  const { count: exactAnime } = await supabase
    .from('anime')
    .select('*', { count: 'exact', head: true })
    .eq('media_type', 'anime');

  const { count: exactManga } = await supabase
    .from('anime')
    .select('*', { count: 'exact', head: true })
    .eq('media_type', 'manga');

  console.log(`  - anime: ${exactAnime ?? 0}`);
  console.log(`  - manga: ${exactManga ?? 0}`);
  console.log('========================================\n');
}

async function main() {
  const arg = (process.argv[2] || '').toLowerCase().trim();

  if (!['anime', 'manga', 'all'].includes(arg)) {
    console.log('Usage: node scripts/seed.cjs [anime|manga|all]');
    console.log('  anime - Seeds top ~2000 popular anime');
    console.log('  manga - Seeds top ~2000 popular manga');
    console.log('  all   - Seeds both anime and manga');
    process.exit(1);
  }

  if (arg === 'anime') {
    await seedMediaType('anime');
  } else if (arg === 'manga') {
    await seedMediaType('manga');
  } else if (arg === 'all') {
    await seedMediaType('anime');
    await seedMediaType('manga');
  }

  await reportFinalCounts();
}

main().catch((err) => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
