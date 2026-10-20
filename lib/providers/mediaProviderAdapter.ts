/**
 * Media Provider Adapter for Nayozu
 *
 * Implements provider abstraction, link classification, security allowlists,
 * and media resolution for video playback and manga reading.
 */

import { DEMO_MEDIA } from "@/lib/features";
import type { ExternalLink } from "@/lib/services/normalizeAnime";

export type LinkCategory = "streaming" | "info" | "social";

export type VideoProviderKind =
  | "youtube"
  | "vimeo"
  | "cloudflare"
  | "mux"
  | "archive_org"
  | "direct";

export type MangaProviderKind = "creator" | "demo";

export interface VideoEpisode {
  id: string;
  number: number;
  title: string;
  synopsis?: string;
  duration?: string;
  thumbnail?: string;
  embedUrl: string;
  provider: VideoProviderKind;
  isDemo?: boolean;
  credit?: string;
}

export interface MangaChapter {
  id: string;
  number: number;
  title: string;
  scanlationGroup?: string;
  releaseDate?: string;
  pages: string[];
  isDemo?: boolean;
  provider: MangaProviderKind;
  credit?: string;
}

/**
 * Strict allowlist of permitted embed domains to prevent arbitrary iframe injection.
 */
export const ALLOWED_EMBED_DOMAINS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
  "iframe.videodelivery.net",
  "stream.mux.com",
  "archive.org",
];

/**
 * Validates that an embed URL belongs to an authorized, trusted provider domain.
 */
export function isAllowedEmbedUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_EMBED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * Classifies an external link into STREAMING, SOCIAL, or INFO category.
 */
export function classifyExternalLink(link: {
  site?: string;
  url: string;
  type?: string | null;
}): LinkCategory {
  const site = (link.site || "").toLowerCase();
  const type = (link.type || "").toUpperCase();
  const url = link.url.toLowerCase();

  if (type === "STREAMING") return "streaming";
  if (type === "SOCIAL") return "social";
  if (type === "INFO") return "info";

  // Known streaming / reading platforms
  const streamingKeywords = [
    "crunchyroll",
    "netflix",
    "hulu",
    "hidive",
    "vrv",
    "funimation",
    "bilibili",
    "iqiyi",
    "disney",
    "prime video",
    "shonen jump",
    "manga plus",
    "viz",
    "lezhin",
    "tapas",
    "webtoon",
    "piccoma",
    "naver series",
    "kakao",
    "bookwalker",
    "manga park",
    "young animal",
  ];

  if (streamingKeywords.some((k) => site.includes(k) || url.includes(k))) {
    return "streaming";
  }

  // Known social networks
  const socialKeywords = [
    "twitter",
    "x.com",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
    "discord",
    "reddit",
    "weibo",
    "threads.net",
  ];

  if (socialKeywords.some((k) => site.includes(k) || url.includes(k))) {
    return "social";
  }

  return "info";
}

/**
 * De-duplicates a list of external links by site name (one entry per site).
 * Prefers English language entries (e.g. 'English', 'en-US') or no-language entries over other languages.
 */
export function deduplicateLinksBySite(links: ExternalLink[]): ExternalLink[] {
  const map = new Map<string, ExternalLink>();

  for (const link of links) {
    if (!link.site || !link.url) continue;
    const siteKey = link.site.trim().toLowerCase();

    const existing = map.get(siteKey);
    if (!existing) {
      map.set(siteKey, link);
      continue;
    }

    const lang = (link.language || "").trim().toLowerCase();
    const existingLang = (existing.language || "").trim().toLowerCase();

    // Preference: 2 = English, 1 = No language, 0 = Other language
    const getPriority = (l: string) => {
      if (l.includes("en") || l === "english") return 2;
      if (!l) return 1;
      return 0;
    };

    if (getPriority(lang) > getPriority(existingLang)) {
      map.set(siteKey, link);
    }
  }

  return Array.from(map.values());
}

/**
 * Constructs a secure YouTube no-cookie embed URL.
 */
export function buildYouTubeEmbedUrl(
  id: string,
  kind: "video" | "playlist" = "video"
): string {
  const safeId = encodeURIComponent(id.trim());
  if (kind === "playlist") {
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${safeId}&rel=0`;
  }
  return `https://www.youtube-nocookie.com/embed/${safeId}?rel=0`;
}

/**
 * Resolves available anime episodes for in-site playback.
 * - For official_video_kind = 'video', returns a single player with no episode selector.
 * - For 'playlist', embeds the YouTube playlist and uses its own controls.
 * - Does not invent episode titles.
 * - Returns [] unless a real source exists (official_video_id). Demo content returned ONLY when DEMO_MEDIA is true.
 */
export function resolveAnimeEpisodes(item: {
  id: string;
  title: string;
  officialVideoId?: string | null;
  officialVideoKind?: "video" | "playlist" | null;
  officialVideoCredit?: string | null;
  episodeCount?: number | null;
  coverImage?: string | null;
}): VideoEpisode[] {
  // 1. Real source: official in-site video configured in DB
  if (item.officialVideoId) {
    const kind = item.officialVideoKind === "playlist" ? "playlist" : "video";
    const credit = item.officialVideoCredit || undefined;

    return [
      {
        id: `${item.id}-${kind}`,
        number: 1,
        title: item.title,
        embedUrl: buildYouTubeEmbedUrl(item.officialVideoId, kind),
        provider: "youtube",
        credit,
      },
    ];
  }

  // 2. Demo content only when DEMO_MEDIA flag is true
  if (DEMO_MEDIA) {
    return [
      {
        id: `${item.id}-demo-ep1`,
        number: 1,
        title: item.title,
        embedUrl: "https://www.youtube-nocookie.com/embed/eRsGyueVLvQ?rel=0",
        provider: "youtube",
        isDemo: true,
        credit: "Blender Open Movie Initiative (CC-BY 3.0)",
      },
    ];
  }

  // No real source exists -> return empty array
  return [];
}

/**
 * Resolves available manga chapters for in-site reading.
 * Returns [] unless real chapter data exists. Demo content returned ONLY when DEMO_MEDIA is true.
 */
export function resolveMangaChapters(item: {
  id: string;
  title: string;
  chapterCount?: number | null;
  externalLinks?: Array<{ site: string; url: string }> | null;
}): MangaChapter[] {
  // Real chapter data (when connected) goes here.
  // Currently, no real chapter data is in DB.

  if (DEMO_MEDIA) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200">
      <rect width="800" height="1200" fill="#09090b"/>
      <rect x="40" y="40" width="720" height="1120" rx="16" fill="#18181b" stroke="#27272a" stroke-width="2"/>
      <text x="400" y="600" fill="#e4e4e7" font-family="system-ui, sans-serif" font-size="24" text-anchor="middle">Demo Chapter</text>
    </svg>`;
    const pageDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

    return [
      {
        id: `${item.id}-demo-ch1`,
        number: 1,
        title: "Chapter 1",
        pages: [pageDataUrl],
        isDemo: true,
        provider: "demo",
        credit: "Demo Reader",
      },
    ];
  }

  // No real source exists -> return empty array
  return [];
}
