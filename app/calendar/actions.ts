"use server";

import { createClient } from "@/lib/supabase/server";

export interface CalendarScheduleItem {
  id: string;
  airingAt: number; // UNIX timestamp in seconds (UTC)
  episode: number;
  totalEpisodes: number | null;
  animeExternalId: number;
  slug: string;
  title: string;
  titleRomaji: string;
  coverImage: string | null;
  format: string | null;
  averageScore: number | null;
  genres: string[];
  inCatalog: boolean;
}

export interface CatalogReleasingFallbackItem {
  externalId: number;
  slug: string;
  title: string;
  coverImage: string | null;
  format: string | null;
  episodes: number | null;
  season: string | null;
  year: number | null;
  averageScore: number | null;
}

export interface CalendarWeekResult {
  providerMode: "anilist_live" | "catalog_fallback";
  items: CalendarScheduleItem[];
  fallbackItems: CatalogReleasingFallbackItem[];
  limitationNotice?: string | null;
  error?: string | null;
}

function buildAnimeSlug(title: string, id: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "anime"}-anime-${id}`;
}

const AIRING_SCHEDULE_QUERY = `
  query ($page: Int, $perPage: Int, $start: Int, $end: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
      }
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: [TIME]) {
        id
        airingAt
        episode
        media {
          id
          isAdult
          format
          episodes
          averageScore
          genres
          title {
            romaji
            english
          }
          coverImage {
            large
            extraLarge
          }
        }
      }
    }
  }
`;

export async function fetchCalendarWeekAction(input: {
  startUnix: number;
  endUnix: number;
}): Promise<CalendarWeekResult> {
  const supabase = await createClient();

  // Pad window by 14 hours on each side to cover all IANA timezone offsets (-12h to +14h)
  const start = Math.floor(input.startUnix) - 14 * 3600;
  const end = Math.floor(input.endUnix) + 14 * 3600;

  try {
    interface RawAiringNode {
      id: number;
      airingAt: number;
      episode: number;
      media?: {
        id: number;
        isAdult?: boolean;
        format?: string | null;
        episodes?: number | null;
        averageScore?: number | null;
        genres?: string[] | null;
        title?: { romaji?: string | null; english?: string | null } | null;
        coverImage?: { large?: string | null; extraLarge?: string | null } | null;
      } | null;
    }

    const rawNodes: RawAiringNode[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: AIRING_SCHEDULE_QUERY,
          variables: { page, perPage: 50, start, end },
        }),
        next: { revalidate: 900 },
      });

      if (!res.ok) {
        throw new Error(`AniList schedule API returned HTTP ${res.status}`);
      }

      const json = await res.json();
      const pageData = json?.data?.Page;
      const list = Array.isArray(pageData?.airingSchedules)
        ? (pageData.airingSchedules as RawAiringNode[])
        : [];

      rawNodes.push(...list);

      if (!pageData?.pageInfo?.hasNextPage) {
        break;
      }
    }

    // Filter out adult content and invalid nodes
    const validNodes = rawNodes.filter(
      (n) => n?.media && !n.media.isAdult && typeof n.airingAt === "number"
    );

    const mediaIds = Array.from(
      new Set(validNodes.map((n) => Number(n.media!.id)))
    );

    const catalogSlugMap = new Map<
      number,
      { slug: string; cover: string | null; title: string }
    >();

    if (mediaIds.length > 0) {
      const { data: dbMatches } = await supabase
        .from("anime")
        .select(
          "external_id, slug, cover_image_url, title_romaji, title_english"
        )
        .eq("media_type", "anime")
        .in("external_id", mediaIds);

      for (const row of dbMatches ?? []) {
        catalogSlugMap.set(Number(row.external_id), {
          slug: row.slug,
          cover: row.cover_image_url ?? null,
          title: row.title_english || row.title_romaji,
        });
      }
    }

    const items: CalendarScheduleItem[] = validNodes.map((node) => {
      const m = node.media!;
      const extId = Number(m.id);
      const dbMatch = catalogSlugMap.get(extId);
      const romaji = m.title?.romaji || m.title?.english || `Anime #${extId}`;
      const displayTitle = dbMatch?.title || m.title?.english || romaji;
      const slug = dbMatch?.slug || buildAnimeSlug(romaji, extId);
      const cover =
        dbMatch?.cover ||
        m.coverImage?.extraLarge ||
        m.coverImage?.large ||
        null;

      return {
        id: `${node.id}-${extId}-ep${node.episode}`,
        airingAt: node.airingAt,
        episode: node.episode,
        totalEpisodes: m.episodes ?? null,
        animeExternalId: extId,
        slug,
        title: displayTitle,
        titleRomaji: romaji,
        coverImage: cover,
        format: m.format ?? null,
        averageScore: m.averageScore ?? null,
        genres: Array.isArray(m.genres) ? m.genres.slice(0, 3) : [],
        inCatalog: Boolean(dbMatch),
      };
    });

    return {
      providerMode: "anilist_live",
      items,
      fallbackItems: [],
      limitationNotice: null,
      error: null,
    };
  } catch (err) {
    // Honest fallback: query local Supabase catalog for status = 'RELEASING' without fabricating dates/times
    const { data: releasingRows, error: dbErr } = await supabase
      .from("anime")
      .select(
        "external_id, slug, title_romaji, title_english, cover_image_url, format, episodes, season, season_year, average_score"
      )
      .eq("media_type", "anime")
      .eq("status", "RELEASING")
      .order("popularity", { ascending: false, nullsFirst: false })
      .limit(36);

    if (dbErr) {
      return {
        providerMode: "catalog_fallback",
        items: [],
        fallbackItems: [],
        limitationNotice: null,
        error:
          "Failed to load episode schedule from both AniList and the local catalog.",
      };
    }

    const fallbackItems: CatalogReleasingFallbackItem[] = (
      releasingRows ?? []
    ).map((r) => ({
      externalId: Number(r.external_id),
      slug: r.slug,
      title: r.title_english || r.title_romaji,
      coverImage: r.cover_image_url ?? null,
      format: r.format ?? null,
      episodes: r.episodes ? Number(r.episodes) : null,
      season: r.season ?? null,
      year: r.season_year ? Number(r.season_year) : null,
      averageScore: r.average_score ? Number(r.average_score) : null,
    }));

    const reason =
      err instanceof Error ? err.message : "Provider schedule unavailable";

    return {
      providerMode: "catalog_fallback",
      items: [],
      fallbackItems,
      limitationNotice: `Live episode airing timestamps from AniList could not be reached (${reason}). Showing currently releasing series from the local Nayozu catalog below — exact airing days and times are not stored in the local database and are never fabricated.`,
      error: null,
    };
  }
}
