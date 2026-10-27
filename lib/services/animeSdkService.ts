/**
 * Nayozu — Unified Anime Streaming Service (Anivexa + Kuhi Race + AnimeSDK)
 *
 * Client adapter for interacting with the unified streaming server (port 4000),
 * optional standalone Anivexa server (port 4001), or Kuhi FastAPI server (port 8000).
 * Supports:
 * - Concurrent "fastest-wins" Kuhi provider race + EMA latency ranking
 * - 14 Anivexa providers + 5 AnimeSDK providers + Miruro pipe fallback
 * - Exact AniList ID or title-based resolution
 * - Sub & Dub audio selection
 * - HMAC-SHA256 signed proxy URL rewriting (with FlixCloud manifest/segment support)
 */

import { rewriteStreamToSameOriginProxy } from "@/lib/services/animeSdkProxy";

const SDK_BASE_URL = process.env.ANIMESDK_SERVER_URL || "http://localhost:4000";
const ANIVEXA_FALLBACK_URL = process.env.ANIVEXA_SERVER_URL || "http://localhost:4001";
const KUHI_FALLBACK_URL = process.env.KUHI_SERVER_URL || "http://127.0.0.1:8000";

export const ANIMESDK_PROVIDERS = [
  { id: "auto", name: "Auto", label: "Auto (Fastest Race)" },
  { id: "anineko", name: "AniNeko", label: "Anivexa — AniNeko" },
  { id: "anizone", name: "AniZone", label: "Anivexa — AniZone" },
  { id: "anikoto", name: "AniKoto", label: "Anivexa — AniKoto" },
  { id: "reanime", name: "ReAnime", label: "Anivexa — ReAnime (FlixCloud)" },
  { id: "aniwaves", name: "AniWaves", label: "Anivexa — AniWaves" },
  { id: "kaa", name: "KickAssAnime", label: "Anivexa — KickAssAnime" },
  { id: "animegg", name: "AnimeGG", label: "Anivexa — AnimeGG" },
  { id: "mkissa", name: "MKissa", label: "Anivexa — MKissa" },
  { id: "anibd", name: "AniBD", label: "Anivexa — AniBD" },
  { id: "senshi", name: "Senshi", label: "Anivexa — Senshi" },
  { id: "animeonsen", name: "AnimeOnsen", label: "Anivexa — AnimeOnsen" },
  { id: "animedunya", name: "AnimeDunya", label: "Anivexa — AnimeDunya" },
  { id: "anidbapp", name: "AniDBApp", label: "Anivexa — AniDBApp" },
  { id: "animenosub", name: "AnimeNoSub", label: "Anivexa — AnimeNoSub" },
  { id: "animeparadise", name: "AnimeParadise", label: "AnimeSDK — AnimeParadise" },
  { id: "megaplay", name: "MegaPlay", label: "AnimeSDK — MegaPlay" },
  { id: "allmanga", name: "AllManga", label: "AnimeSDK — AllManga" },
  { id: "gogoanime", name: "Gogoanime", label: "AnimeSDK — Gogoanime" },
] as const;

export type AnimeSdkProviderId = (typeof ANIMESDK_PROVIDERS)[number]["id"];

export const ANIVEXA_PROVIDER_IDS: readonly string[] = [
  "anineko",
  "anizone",
  "anikoto",
  "reanime",
  "aniwaves",
  "kaa",
  "animegg",
  "mkissa",
  "anibd",
  "senshi",
  "animeonsen",
  "animedunya",
  "anidbapp",
  "animenosub",
];

export const LEGACY_SDK_PROVIDER_IDS: readonly string[] = [
  "animeparadise",
  "anikoto",
  "megaplay",
  "allmanga",
  "gogoanime",
];

export const AUTO_PROVIDER_ORDER: readonly Exclude<AnimeSdkProviderId, "auto">[] = [
  "anineko",
  "anizone",
  "anikoto",
  "reanime",
  "aniwaves",
  "kaa",
  "animeparadise",
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
  headers?: Record<string, string>;
  playlistKey?: string | null;
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
  anilistId?: number;
  episodes?: SdkEpisodeUnit[];
  activeEpisode?: SdkEpisodeUnit;
  stream?: SdkStreamData;
  attempts?: ResolveAttempt[];
  error?: string;
}

/**
 * Checks whether the unified AnimeSDK/Anivexa server (port 4000) or standalone Anivexa (4001) / Kuhi (8000) is running.
 */
export async function checkSdkHealth(): Promise<{
  ok: boolean;
  providers: string[];
  proxy: boolean;
  baseUrl: string;
  latencyRanking?: Array<{ name: string; ema_seconds: number }>;
}> {
  const candidates = [SDK_BASE_URL, ANIVEXA_FALLBACK_URL, KUHI_FALLBACK_URL];
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const isOk = Boolean(data.ok || data.status === "ok");
      if (!isOk) continue;

      const providers = Array.from(
        new Set([
          ...(Array.isArray(data.providers) ? data.providers : []),
          ...(Array.isArray(data.anivexaProviders) ? data.anivexaProviders : []),
          ...(Array.isArray(data.sdkProviders) ? data.sdkProviders : []),
          ...(base === KUHI_FALLBACK_URL ? ANIVEXA_PROVIDER_IDS : []),
        ])
      );

      return {
        ok: true,
        providers,
        proxy: true,
        baseUrl: base,
        latencyRanking: Array.isArray(data.latencyRanking) ? data.latencyRanking : undefined,
      };
    } catch {
      // Try next candidate
    }
  }

  return { ok: false, providers: [], proxy: false, baseUrl: SDK_BASE_URL };
}

/**
 * Converts a normalized Anivexa/Kuhi stream payload into Nayozu's `SdkStreamData`.
 */
function toSdkStreamData(
  payload: {
    streams?: Array<{
      url?: string;
      sourceUrl?: string;
      type?: string;
      isHLS?: boolean;
      quality?: string;
      server?: string;
      headers?: Record<string, string>;
      referer?: string;
      playlistKey?: string | null;
      playlist_key?: string | null;
      key?: string | null;
      subtitles?: Array<{
        url?: string;
        file?: string;
        label?: string;
        language?: string;
        srclang?: string;
        lang?: string;
        format?: string;
        default?: boolean;
      }>;
    }>;
    sources?: Array<{
      name?: string;
      url?: string;
      extractedUrl?: string;
      extractedType?: string;
      type?: string;
      headers?: Record<string, string>;
    }>;
    stream_url?: string;
    subtitles?: Array<{
      url?: string;
      file?: string;
      label?: string;
      language?: string;
      srclang?: string;
      lang?: string;
      format?: string;
      default?: boolean;
    }>;
  },
  language = "sub"
): SdkStreamData {
  const rawSubs = Array.isArray(payload.subtitles) ? [...payload.subtitles] : [];
  const items: SdkStreamItem[] = [];

  if (Array.isArray(payload.streams)) {
    for (const s of payload.streams) {
      const sourceUrl = s.sourceUrl || s.url;
      if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
      if (s.type === "embed") continue;

      if (Array.isArray(s.subtitles)) {
        rawSubs.push(...s.subtitles);
      }

      const headers: Record<string, string> = {
        ...(s.headers || {}),
        ...(s.referer ? { Referer: s.referer } : {}),
      };

      const isHLS =
        typeof s.isHLS === "boolean"
          ? s.isHLS
          : String(s.type || "").toLowerCase() === "hls" || sourceUrl.includes(".m3u8");

      items.push({
        sourceUrl,
        isHLS,
        quality: s.quality || s.server || "auto",
        language,
        headers,
        playlistKey: s.playlistKey || s.playlist_key || s.key || null,
      });
    }
  }

  if (Array.isArray(payload.sources)) {
    for (const src of payload.sources) {
      const sourceUrl = src.extractedUrl || (src.type === "player" ? src.url : undefined);
      if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
      const isHLS =
        src.extractedType === "hls" || sourceUrl.includes(".m3u8");
      items.push({
        sourceUrl,
        isHLS,
        quality: src.name || "auto",
        language,
        headers: src.headers || {},
      });
    }
  }

  if (items.length === 0 && typeof payload.stream_url === "string" && /^https?:\/\//i.test(payload.stream_url)) {
    items.push({
      sourceUrl: payload.stream_url,
      isHLS: payload.stream_url.includes(".m3u8"),
      quality: "auto",
      language,
    });
  }

  const seenSubs = new Set<string>();
  const normalizedSubs: SdkSubtitle[] = [];
  for (const sub of rawSubs) {
    const subUrl = sub?.url || sub?.file;
    if (!subUrl || seenSubs.has(subUrl)) continue;
    seenSubs.add(subUrl);
    normalizedSubs.push({
      url: subUrl,
      label: sub.label || sub.lang || sub.srclang || "English",
      language: sub.language || sub.srclang || sub.lang || "en",
      format: sub.format || (subUrl.toLowerCase().endsWith(".ass") ? "ass" : "vtt"),
      default: Boolean(sub.default),
    });
  }

  if (normalizedSubs.length > 0 && items.length > 0) {
    items[0].subtitles = normalizedSubs;
  }

  return {
    type: "video",
    streams: items,
  };
}

/**
 * Searches a provider for an anime title.
 */
export async function searchSdkProvider(
  provider: string,
  query: string
): Promise<SdkSearchResult[]> {
  if (ANIVEXA_PROVIDER_IDS.includes(provider) && !LEGACY_SDK_PROVIDER_IDS.includes(provider)) {
    // Use Kuhi/Anivexa extract endpoint to resolve AniList ID and title
    const res = await fetch(
      `${SDK_BASE_URL}/extract/${encodeURIComponent(query)}`,
      { cache: "no-store", signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.anilist_id) return [];
    return [
      {
        id: String(data.anilist_id),
        title: data.title || query,
        providerId: provider,
      },
    ];
  }

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
  if (/^\d+$/.test(mediaId) && ANIVEXA_PROVIDER_IDS.includes(provider)) {
    const res = await fetch(
      `${SDK_BASE_URL}/episodes/${encodeURIComponent(provider)}/${encodeURIComponent(mediaId)}?map=false`,
      { cache: "no-store", signal: AbortSignal.timeout(9500) }
    );
    if (res.ok) {
      const data = await res.json();
      const block = data?.[provider];
      const subEps = Array.isArray(block?.episodes?.sub) ? block.episodes.sub : [];
      const dubEps = Array.isArray(block?.episodes?.dub) ? block.episodes.dub : [];
      const dubSet = new Set(dubEps.map((e: { number?: number }) => Number(e.number)));

      if (subEps.length > 0 || dubEps.length > 0) {
        const baseList = subEps.length >= dubEps.length ? subEps : dubEps;
        return baseList.map((ep: { id?: string; number?: number; title?: string }) => {
          const num = Number(ep.number) || 1;
          return {
            id: ep.id || `watch/${provider}/${mediaId}/sub/${provider}-${num}`,
            title: ep.title || `Episode ${num}`,
            number: num,
            availableLanguages: dubSet.has(num) ? ["sub", "dub"] : ["sub"],
          };
        });
      }
    }
  }

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
 * Supports both Anivexa watch paths (`watch/:provider/:anilistId/:audio/:provider-:ep`)
 * and legacy AnimeSDK unitIds.
 */
export async function resolveSdkStream(
  provider: string,
  unitId: string,
  language = "sub"
): Promise<SdkStreamData> {
  // Check if unitId is already an Anivexa watch path (prevents doubled /watch/.../watch/... bug)
  const cleanUnit = unitId.replace(/^\/+/, "");
  const watchMatch = cleanUnit.match(
    /^watch\/([a-z0-9_-]+)\/(\d+)\/(sub|dub)\/\1-(\d+)$/i
  );

  if (watchMatch) {
    const [, watchProvider, anilistId, , epNum] = watchMatch;
    const targetAudio = language === "dub" ? "dub" : "sub";
    const watchPath = `/watch/${watchProvider}/${anilistId}/${targetAudio}/${watchProvider}-${epNum}`;
    const res = await fetch(`${SDK_BASE_URL}${watchPath}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const sdkStream = toSdkStreamData(data, targetAudio);
      if (sdkStream.streams.length > 0) {
        return sdkStream;
      }
    }

    // If the specific provider failed on episode switch, race all providers for this AniList ID + episode!
    const raceRes = await fetch(
      `${SDK_BASE_URL}/race/${anilistId}/${targetAudio}/${epNum}?provider=${encodeURIComponent(
        watchProvider
      )}`,
      { cache: "no-store", signal: AbortSignal.timeout(11000) }
    );
    if (raceRes.ok) {
      const raceData = await raceRes.json();
      const sdkStream = toSdkStreamData(raceData, targetAudio);
      if (sdkStream.streams.length > 0) {
        return sdkStream;
      }
    }

    throw new Error(`No playable stream returned for ${watchPath}`);
  }

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

/**
 * Resolves via the unified Kuhi Race + Anivexa engine using an AniList ID or title query.
 */
async function tryKuhiAnivexaResolution(options: {
  baseUrl: string;
  query: string;
  provider: string;
  episodeNumber: number;
  language: string;
}): Promise<ResolveResponse | null> {
  const { baseUrl, query, provider, episodeNumber, language } = options;
  const audio = language === "dub" ? "dub" : "sub";

  try {
    const extractUrl = new URL(`${baseUrl}/extract/${encodeURIComponent(query)}`);
    extractUrl.searchParams.set("ep", String(episodeNumber));
    extractUrl.searchParams.set("audio", audio);
    if (audio === "dub") extractUrl.searchParams.set("dub", "true");
    if (provider && provider !== "auto") {
      extractUrl.searchParams.set("provider", provider);
    }

    const res = await fetch(extractUrl.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const anilistId = Number(data.anilist_id);
    const winningProvider = String(data.provider || (provider !== "auto" ? provider : "anineko"));
    const sdkStream = toSdkStreamData(data, audio);

    if (!sdkStream.streams || sdkStream.streams.length === 0) {
      return null;
    }

    const proxiedStream = rewriteStreamToSameOriginProxy(sdkStream, "/api/anime-sdk/proxy");

    // Build episode list from merged episodes
    const rawSubEps = Array.isArray(data?.episodes?.sub) ? data.episodes.sub : [];
    const rawDubEps = Array.isArray(data?.episodes?.dub) ? data.episodes.dub : [];
    const dubNums = new Set(rawDubEps.map((e: { number?: number }) => Number(e.number)));
    const sourceList = audio === "dub" && rawDubEps.length > 0 ? rawDubEps : rawSubEps;

    const cleanProvider = winningProvider.replace(/^miruro:/, "");
    const episodes: SdkEpisodeUnit[] =
      sourceList.length > 0
        ? sourceList.map((ep: { id?: string; number?: number; title?: string }) => {
            const num = Number(ep.number) || 1;
            return {
              id: `watch/${cleanProvider}/${anilistId}/${audio}/${cleanProvider}-${num}`,
              title: ep.title || `Episode ${num}`,
              number: num,
              availableLanguages: dubNums.has(num) ? ["sub", "dub"] : ["sub"],
            };
          })
        : [
            {
              id: `watch/${cleanProvider}/${anilistId}/${audio}/${cleanProvider}-${episodeNumber}`,
              title: `Episode ${episodeNumber}`,
              number: episodeNumber,
              availableLanguages: ["sub", "dub"],
            },
          ];

    const activeEpisode =
      episodes.find((ep) => ep.number === episodeNumber) || episodes[0];

    const meta = ANIMESDK_PROVIDERS.find((p) => p.id === cleanProvider);

    return {
      success: true,
      provider: winningProvider,
      providerName: meta ? meta.label : `Anivexa — ${winningProvider}`,
      mediaTitle: data.title || query,
      mediaId: String(anilistId),
      anilistId,
      episodes,
      activeEpisode,
      stream: proxiedStream,
      attempts: [{ provider: winningProvider, status: "success" }],
    };
  } catch {
    return null;
  }
}

type ProviderResult =
  | { ok: true; response: ResolveResponse }
  | { ok: false; attempt: ResolveAttempt };

/**
 * Tries one legacy AnimeSDK provider end to end: search -> episodes -> stream.
 */
async function tryLegacySdkProvider(
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
        if (
          !rawStream.streams ||
          rawStream.streams.length === 0 ||
          !rawStream.streams[0].sourceUrl
        ) {
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
 * Resolves an anime by AniList ID or title and episode number using:
 * 1. Kuhi concurrent provider race across Anivexa's 14 providers (+ Miruro fallback)
 * 2. Legacy AnimeSDK provider fallback chain
 */
export async function resolveAnimeStream(options: {
  title: string;
  anilistId?: number | string | null;
  provider?: AnimeSdkProviderId | string;
  episodeNumber?: number;
  language?: string;
}): Promise<ResolveResponse> {
  const {
    title,
    anilistId,
    provider = "auto",
    episodeNumber = 1,
    language = "sub",
  } = options;

  const health = await checkSdkHealth();
  if (!health.ok) {
    return {
      success: false,
      isServerDown: true,
      error:
        "Streaming server is not running on port 4000. Start it by running 'npm run sdk:server' in your terminal.",
    };
  }

  const cleanTitle = title.replace(/\s*\(TV\)/i, "").trim();
  const numericAnilistId =
    anilistId && /^\d+$/.test(String(anilistId).trim())
      ? String(anilistId).trim()
      : /^\d+$/.test(cleanTitle)
      ? cleanTitle
      : null;

  const queryKey = numericAnilistId || cleanTitle;

  // 1. Try Kuhi/Anivexa concurrent engine first when provider is "auto" or an Anivexa provider
  if (provider === "auto" || ANIVEXA_PROVIDER_IDS.includes(provider)) {
    const anivexaResolved = await tryKuhiAnivexaResolution({
      baseUrl: health.baseUrl,
      query: queryKey,
      provider,
      episodeNumber,
      language,
    });

    if (anivexaResolved && anivexaResolved.success) {
      return anivexaResolved;
    }

    // If user requested an Anivexa-only provider (not in legacy SDK), report failure directly
    if (provider !== "auto" && !LEGACY_SDK_PROVIDER_IDS.includes(provider)) {
      return {
        success: false,
        provider,
        error: `Provider '${provider}' did not return a playable ${language.toUpperCase()} stream for episode ${episodeNumber}.`,
        attempts: [{ provider, status: "stream_failed" }],
      };
    }
  }

  // 2. Specific legacy AnimeSDK provider requested
  if (provider !== "auto") {
    const result = await tryLegacySdkProvider(
      provider,
      cleanTitle,
      episodeNumber,
      language
    );
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

  // 3. Auto fallback across legacy AnimeSDK providers
  const attempts: ResolveAttempt[] = [
    { provider: "anivexa-race", status: "stream_failed", error: "Race returned no streams" },
  ];

  for (const provId of LEGACY_SDK_PROVIDER_IDS) {
    if (health.providers.length > 0 && !health.providers.includes(provId)) {
      continue;
    }

    const result = await tryLegacySdkProvider(
      provId,
      cleanTitle,
      episodeNumber,
      language
    );
    if (result.ok) {
      attempts.push({ provider: provId, status: "success" });
      return { ...result.response, attempts };
    }
    attempts.push(result.attempt);
  }

  return {
    success: false,
    error: `Auto resolution could not find a playable stream across Anivexa & AnimeSDK providers.`,
    attempts,
  };
}
