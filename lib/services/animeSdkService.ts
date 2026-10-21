/**
 * Nayozu — AnimeSDK Service
 *
 * Client adapter for interacting with the AnimeSDK standalone server (port 4000).
 * Handles health checks, provider status, automated multi-provider fallback ("Auto"),
 * episode enumeration, and stream resolution.
 */

import {
  rewriteStreamToSameOriginProxy,
} from "@/lib/services/animeSdkProxy";

const SDK_BASE_URL = process.env.ANIMESDK_SERVER_URL || "http://localhost:4000";

export const ANIMESDK_PROVIDERS = [
  { id: "auto", name: "Auto", label: "Auto (Recommended)" },
  { id: "allmanga", name: "AllManga", label: "AnimeSDK — AllManga" },
  { id: "anikoto", name: "AniKoto", label: "AnimeSDK — AniKoto" },
  { id: "animeparadise", name: "AnimeParadise", label: "AnimeSDK — AnimeParadise" },
  { id: "gogoanime", name: "Gogoanime", label: "AnimeSDK — Gogoanime" },
  { id: "megaplay", name: "MegaPlay", label: "AnimeSDK — MegaPlay" },
] as const;

export type AnimeSdkProviderId =
  | "auto"
  | "allmanga"
  | "anikoto"
  | "animeparadise"
  | "gogoanime"
  | "megaplay";

export const AUTO_PROVIDER_ORDER: readonly (Exclude<AnimeSdkProviderId, "auto">)[] = [
  "animeparadise",
  "anikoto",
  "megaplay",
  "allmanga",
  "gogoanime",
];

export interface SdkSubtitle {
  url: string;
  label: string;
  language: string;
  format?: string;
  default?: boolean;
}

export interface SdkStreamItem {
  sourceUrl: string;
  isHLS?: boolean;
  quality?: string;
  language?: string;
  subtitles?: SdkSubtitle[];
}

export interface SdkStreamData {
  type: "video";
  streams: SdkStreamItem[];
}

export interface SdkEpisodeUnit {
  id: string;
  title: string;
  number: number;
  availableLanguages?: string[];
}

export interface SdkSearchResult {
  id: string;
  title: string;
  thumbnailUrl?: string;
  providerId?: string;
}

export interface ResolveAttempt {
  provider: string;
  status: "success" | "search_empty" | "no_episodes" | "stream_failed" | "error";
  error?: string;
}

export interface ResolveResponse {
  success: boolean;
  isServerDown?: boolean;
  provider?: string;
  providerName?: string;
  mediaTitle?: string;
  mediaId?: string;
  episodes?: SdkEpisodeUnit[];
  activeEpisode?: SdkEpisodeUnit;
  stream?: SdkStreamData;
  attempts?: ResolveAttempt[];
  error?: string;
}

/**
 * Checks whether the standalone AnimeSDK server is running and healthy.
 */
export async function checkSdkHealth(): Promise<{
  ok: boolean;
  providers: string[];
  proxy: boolean;
}> {
  try {
    const res = await fetch(`${SDK_BASE_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { ok: false, providers: [], proxy: false };
    }
    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      providers: Array.isArray(data.providers) ? data.providers : [],
      proxy: Boolean(data.proxy),
    };
  } catch {
    return { ok: false, providers: [], proxy: false };
  }
}

/**
 * Searches a provider for an anime title.
 */
export async function searchSdkProvider(
  provider: string,
  query: string
): Promise<SdkSearchResult[]> {
  const url = `${SDK_BASE_URL}/search?provider=${encodeURIComponent(
    provider
  )}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Search failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * Fetches episode units for a specific media item.
 */
export async function fetchSdkEpisodes(
  provider: string,
  mediaId: string
): Promise<SdkEpisodeUnit[]> {
  const url = `${SDK_BASE_URL}/content?provider=${encodeURIComponent(
    provider
  )}&mediaId=${encodeURIComponent(mediaId)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fetch episodes failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

/**
 * Resolves video stream for a specific episode unit.
 */
export async function resolveSdkStream(
  provider: string,
  unitId: string,
  language = "sub"
): Promise<SdkStreamData> {
  const url = `${SDK_BASE_URL}/stream?provider=${encodeURIComponent(
    provider
  )}&unitId=${encodeURIComponent(unitId)}&language=${encodeURIComponent(language)}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stream resolution failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

type ProviderResult =
  | { ok: true; response: ResolveResponse }
  | { ok: false; attempt: ResolveAttempt };

/**
 * Tries one provider end to end: search -> episodes -> stream.
 * Providers may list several units for the same episode number (e.g. one per
 * server or language), so every matching unit is tried before giving up.
 */
async function tryProvider(
  provId: string,
  cleanTitle: string,
  episodeNumber: number,
  language: string
): Promise<ProviderResult> {
  try {
    const results = await searchSdkProvider(provId, cleanTitle);
    if (!results || results.length === 0) {
      return { ok: false, attempt: { provider: provId, status: "search_empty" } };
    }

    const match = results[0];
    const episodes = await fetchSdkEpisodes(provId, match.id);
    if (!episodes || episodes.length === 0) {
      return { ok: false, attempt: { provider: provId, status: "no_episodes" } };
    }

    const candidates = episodes.filter((ep) => ep.number === episodeNumber);
    if (candidates.length === 0) candidates.push(episodes[0]);

    let lastError = "Empty stream array";
    for (const unit of candidates) {
      try {
        const rawStream = await resolveSdkStream(provId, unit.id, language);
        if (!rawStream.streams || rawStream.streams.length === 0 || !rawStream.streams[0].sourceUrl) {
          lastError = "Empty stream array";
          continue;
        }

        const stream = rewriteStreamToSameOriginProxy(rawStream, "/api/anime-sdk/proxy");
        const meta = ANIMESDK_PROVIDERS.find((p) => p.id === provId);
        return {
          ok: true,
          response: {
            success: true,
            provider: provId,
            providerName: meta ? meta.label : provId,
            mediaTitle: match.title,
            mediaId: match.id,
            episodes,
            activeEpisode: unit,
            stream,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      ok: false,
      attempt: { provider: provId, status: "stream_failed", error: lastError },
    };
  } catch (err) {
    return {
      ok: false,
      attempt: {
        provider: provId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Resolves an anime by title and episode number using either a specific provider
 * or the automated fallback chain (Auto).
 */
export async function resolveAnimeStream(options: {
  title: string;
  provider?: AnimeSdkProviderId | string;
  episodeNumber?: number;
  language?: string;
}): Promise<ResolveResponse> {
  const { title, provider = "auto", episodeNumber = 1, language = "sub" } = options;

  const health = await checkSdkHealth();
  if (!health.ok) {
    return {
      success: false,
      isServerDown: true,
      error:
        "AnimeSDK server is not running on port 4000. Start it by running 'npm run sdk:server' in your terminal.",
    };
  }

  const cleanTitle = title.replace(/\s*\(TV\)/i, "").trim();

  // Specific provider requested
  if (provider !== "auto") {
    const result = await tryProvider(provider, cleanTitle, episodeNumber, language);
    if (result.ok) {
      return { ...result.response, attempts: [{ provider, status: "success" }] };
    }
    const { status, error } = result.attempt;
    return {
      success: false,
      provider,
      error: `Provider '${provider}' failed (${status})${error ? `: ${error}` : ""}`,
      attempts: [result.attempt],
    };
  }

  // Auto fallback mode: try providers in order
  const attempts: ResolveAttempt[] = [];

  for (const provId of AUTO_PROVIDER_ORDER) {
    if (health.providers.length > 0 && !health.providers.includes(provId)) {
      continue;
    }

    const result = await tryProvider(provId, cleanTitle, episodeNumber, language);
    if (result.ok) {
      attempts.push({ provider: provId, status: "success" });
      return { ...result.response, attempts };
    }
    attempts.push(result.attempt);
  }

  return {
    success: false,
    error: `Auto resolution could not find a playable stream across providers (${AUTO_PROVIDER_ORDER.join(
      ", "
    )}).`,
    attempts,
  };
}