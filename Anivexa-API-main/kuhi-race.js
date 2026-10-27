/**
 * Kuhi Race + Miruro Fallback Engine (ported from anime-api-main/src/providers/_race.py & extractor.py)
 *
 * Provides:
 * - Rolling EMA latency ranking across all Anivexa/Kuhi providers
 * - Concurrent "fastest-wins" raceWatch() with per-provider timeout & verification
 * - AniList search-by-title or numeric ID resolution
 * - Miruro pipe fallback (base64url + gzip decoding) when native providers fail
 */

import zlib from "node:zlib";
import anivexaApi from "./index.js";
import { getMedia } from "./core/anilist.js";
import { getFilteredEpisodesResponse } from "./core/episode-cache.js";
import { resolveProviders } from "./core/episode-strategy.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ANILIST_GQL = "https://graphql.anilist.co";
const MIRURO_DOMAINS = [
  "https://www.miruro.ru",
  "https://www.miruro.bz",
  "https://www.miruro.online",
];

// Default provider race order (fast & reliable first, matching Kuhi API _race.py)
export const RACE_PROVIDER_ORDER = [
  "anineko",
  "anizone",
  "anikoto",
  "reanime",
  "aniwaves",
  "kaa",
  "anibd",
  "animegg",
  "mkissa",
  "animeonsen",
  "senshi",
  "animedunya",
  "anidbapp",
  "animenosub",
];

// Rolling EMA latency table (seconds) — lower = faster
const latencyEma = new Map(
  RACE_PROVIDER_ORDER.map((name, idx) => [name, 1.5 + idx * 0.15])
);

const titleSearchCache = new Map();

export function recordProviderLatency(name, dtSeconds, ok) {
  const prev = latencyEma.get(name) ?? 3.0;
  const sample = ok ? dtSeconds : Math.max(dtSeconds, 12.0);
  latencyEma.set(name, 0.7 * prev + 0.3 * sample);
}

export function getRankedProviders(preferredProvider = null) {
  const ordered = [...RACE_PROVIDER_ORDER].sort(
    (a, b) => (latencyEma.get(a) ?? 9.0) - (latencyEma.get(b) ?? 9.0)
  );
  if (preferredProvider && ordered.includes(preferredProvider)) {
    return [
      preferredProvider,
      ...ordered.filter((p) => p !== preferredProvider),
    ];
  }
  return ordered;
}

export function getProvidersStatus() {
  return {
    providers: getRankedProviders().map((name) => ({
      name,
      ema_seconds: Number((latencyEma.get(name) ?? 3.0).toFixed(3)),
    })),
  };
}

/**
 * Resolve an anime query (numeric AniList ID or title string) to AniList media metadata.
 */
export async function resolveAnilistQuery(queryOrId) {
  const raw = String(queryOrId ?? "").trim();
  if (!raw) throw new Error("Empty anime query");

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    const media = await getMedia(id);
    return {
      anilistId: id,
      title:
        media?.title?.english ||
        media?.title?.romaji ||
        media?.title?.native ||
        `Anime #${id}`,
      media,
    };
  }

  const cacheKey = raw.toLowerCase();
  const cached = titleSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const gql = `
    query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
          id
          idMal
          title { romaji english native }
          status
          format
          episodes
          seasonYear
          startDate { year }
          synonyms
        }
      }
    }
  `;

  const res = await fetch(ANILIST_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ query: gql, variables: { search: raw } }),
  });

  if (!res.ok) {
    throw new Error(`AniList search failed with HTTP ${res.status}`);
  }

  const json = await res.json();
  const list = json?.data?.Page?.media ?? [];
  if (!list.length) {
    throw new Error(`No AniList match found for "${raw}"`);
  }

  const top = list[0];
  const value = {
    anilistId: Number(top.id),
    title:
      top.title?.english ||
      top.title?.romaji ||
      top.title?.native ||
      raw,
    media: top,
    candidates: list.map((m) => ({
      id: Number(m.id),
      title: m.title?.english || m.title?.romaji || m.title?.native || String(m.id),
      year: m.seasonYear || m.startDate?.year || null,
      format: m.format || null,
      episodes: m.episodes || null,
    })),
  };

  titleSearchCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + 30 * 60 * 1000,
  });

  return value;
}

/**
 * Normalize an Anivexa provider watch payload into a unified streams + subtitles structure.
 * Handles:
 * - Standard `{ streams: [...], subtitles: [...] }`
 * - ReAnime `{ stream_url, streams: [{ url, key, playlist_key, subtitles, ... }], subtitles }`
 * - MKissa `{ sources: [{ name, url, extractedUrl, extractedType, headers, priority }] }`
 */
export function normalizeAnivexaWatchPayload(raw, providerName) {
  if (!raw || typeof raw !== "object" || raw.error) {
    return null;
  }

  const normalizedStreams = [];
  const rawSubtitles = Array.isArray(raw.subtitles) ? [...raw.subtitles] : [];

  if (Array.isArray(raw.streams)) {
    for (const s of raw.streams) {
      if (!s) continue;
      const url = typeof s === "string" ? s : s.url;
      if (!url || !/^https?:\/\//i.test(url)) continue;

      const type = String(s.type || (url.includes(".m3u8") ? "hls" : "mp4")).toLowerCase();
      // Skip embed-only entries unless no direct/hls/mp4 stream exists
      const referer = s.referer || s.headers?.Referer || s.headers?.referer || null;
      const headers = {
        ...(s.headers && typeof s.headers === "object" ? s.headers : {}),
        ...(referer ? { Referer: referer } : {}),
      };

      if (Array.isArray(s.subtitles)) {
        rawSubtitles.push(...s.subtitles);
      }

      normalizedStreams.push({
        url,
        type,
        quality: s.quality || s.server || "auto",
        server: s.server || providerName,
        headers,
        playlistKey: s.playlist_key || s.key || null,
        embed: s.embed || null,
        isEmbed: type === "embed",
      });
    }
  }

  // Handle MKissa `sources` array
  if (Array.isArray(raw.sources)) {
    for (const src of raw.sources) {
      if (!src) continue;
      const playableUrl = src.extractedUrl || (src.type === "player" ? src.url : null);
      if (!playableUrl || !/^https?:\/\//i.test(playableUrl)) continue;
      const extType =
        src.extractedType ||
        (playableUrl.includes(".m3u8") ? "hls" : playableUrl.includes(".mp4") ? "mp4" : "direct");
      normalizedStreams.push({
        url: playableUrl,
        type: extType === "hls" ? "hls" : "mp4",
        quality: src.name || "auto",
        server: src.name || "mkissa",
        headers: src.headers && typeof src.headers === "object" ? src.headers : {},
        playlistKey: null,
        embed: null,
        isEmbed: false,
      });
    }
  }

  // Fallback to top-level `stream_url` if present
  if (normalizedStreams.length === 0 && typeof raw.stream_url === "string" && /^https?:\/\//i.test(raw.stream_url)) {
    normalizedStreams.push({
      url: raw.stream_url,
      type: raw.stream_url.includes(".m3u8") ? "hls" : "mp4",
      quality: "auto",
      server: providerName,
      headers: {},
      playlistKey: null,
      embed: null,
      isEmbed: false,
    });
  }

  // Filter out pure embeds if we have playable HLS/MP4/DASH streams
  const playable = normalizedStreams.filter((s) => !s.isEmbed);
  const chosenStreams = playable.length > 0 ? playable : normalizedStreams;
  if (chosenStreams.length === 0) {
    return null;
  }

  // Deduplicate and normalize subtitles
  const seenSubUrls = new Set();
  const subtitles = [];
  for (const sub of rawSubtitles) {
    const subUrl = sub?.url || sub?.file;
    if (!subUrl || typeof subUrl !== "string" || seenSubUrls.has(subUrl)) continue;
    seenSubUrls.add(subUrl);
    subtitles.push({
      url: subUrl,
      label: sub.label || sub.lang || sub.srclang || "Subtitle",
      language: sub.language || sub.srclang || sub.lang || "en",
      format: subUrl.toLowerCase().endsWith(".ass")
        ? "ass"
        : subUrl.toLowerCase().endsWith(".srt")
        ? "srt"
        : "vtt",
      default: Boolean(sub.default),
    });
  }

  return {
    provider: providerName,
    streams: chosenStreams,
    subtitles,
    intro: raw.intro ?? null,
    outro: raw.outro ?? null,
    raw,
  };
}

/**
 * Call a single Anivexa provider's /watch endpoint in-process.
 */
export async function callProviderWatch(providerName, anilistId, audio, epNum, timeoutMs = 9500) {
  const t0 = performance.now();
  const path = `/watch/${providerName}/${anilistId}/${audio}/${providerName}-${epNum}`;
  const req = new Request(`http://localhost${path}`, { method: "GET" });

  let timer;
  try {
    const res = await Promise.race([
      anivexaApi.fetch(req),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Provider ${providerName} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);

    if (!res || res.status !== 200) {
      recordProviderLatency(providerName, (performance.now() - t0) / 1000, false);
      return null;
    }

    const data = await res.json();
    const normalized = normalizeAnivexaWatchPayload(data, providerName);
    const ok = Boolean(normalized && normalized.streams.length > 0);
    recordProviderLatency(providerName, (performance.now() - t0) / 1000, ok);
    return normalized;
  } catch {
    recordProviderLatency(providerName, (performance.now() - t0) / 1000, false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kuhi-style concurrent "fastest-wins" provider race.
 * Fires candidate providers concurrently and resolves immediately on the first provider
 * that returns at least one playable stream!
 */
export async function raceWatch(anilistId, audio = "sub", epNum = 1, options = {}) {
  const {
    preferredProvider = null,
    onlyProvider = null,
    timeoutMs = 10000,
    maxProviders = 8,
  } = options;

  const candidates = onlyProvider
    ? [onlyProvider]
    : getRankedProviders(preferredProvider).slice(0, maxProviders);

  return new Promise((resolve) => {
    let settled = false;
    let remaining = candidates.length;

    if (remaining === 0) {
      resolve(null);
      return;
    }

    for (const providerName of candidates) {
      callProviderWatch(providerName, anilistId, audio, epNum, timeoutMs)
        .then((result) => {
          if (!settled && result && result.streams.length > 0) {
            settled = true;
            resolve(result);
            return;
          }
          remaining -= 1;
          if (!settled && remaining <= 0) {
            settled = true;
            resolve(null);
          }
        })
        .catch(() => {
          remaining -= 1;
          if (!settled && remaining <= 0) {
            settled = true;
            resolve(null);
          }
        });
    }
  });
}

/**
 * Merge episode lists from fast providers for an AniList ID.
 */
export async function getMergedEpisodes(anilistId, preferredProviders = ["anineko", "anizone", "anikoto", "reanime", "aniwaves", "kaa"]) {
  const { resolved } = resolveProviders(preferredProviders);
  const data = await getFilteredEpisodesResponse(anilistId, resolved, false);

  const subByNumber = new Map();
  const dubByNumber = new Map();
  const providersPresent = [];

  for (const name of preferredProviders) {
    const block = data?.[name];
    if (!block || typeof block !== "object" || block.error) continue;
    const eps = block.episodes;
    if (!eps || typeof eps !== "object") continue;

    let count = 0;
    for (const ep of eps.sub || []) {
      const n = Number(ep?.number);
      if (Number.isFinite(n) && n > 0 && !subByNumber.has(n)) {
        subByNumber.set(n, { ...ep, provider: name });
        count++;
      }
    }
    for (const ep of eps.dub || []) {
      const n = Number(ep?.number);
      if (Number.isFinite(n) && n > 0 && !dubByNumber.has(n)) {
        dubByNumber.set(n, { ...ep, provider: name });
        count++;
      }
    }
    if (count > 0) providersPresent.push(name);
  }

  return {
    anilistId: Number(anilistId),
    providers: providersPresent,
    episodes: {
      sub: [...subByNumber.keys()].sort((a, b) => a - b).map((n) => subByNumber.get(n)),
      dub: [...dubByNumber.keys()].sort((a, b) => a - b).map((n) => dubByNumber.get(n)),
    },
    raw: data,
  };
}

/**
 * Miruro Secure Pipe Fallback (ported from anime-api-main/src/extractor.py).
 * Encodes payload as base64url JSON -> GET /api/secure/pipe?e=... -> base64url + gzip decode.
 */
async function miruroPipeRequest(domain, path, headers) {
  const payload = {
    path,
    method: "GET",
    query: {},
    headers,
    body: null,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const pipeUrl = `${domain}/api/secure/pipe?e=${encoded}`;

  const res = await fetch(pipeUrl, {
    headers: {
      ...headers,
      Accept: "text/plain, */*",
    },
  });
  if (!res.ok) return null;

  const rawText = (await res.text()).trim();
  if (!rawText) return null;

  const compressed = Buffer.from(rawText, "base64url");
  const decompressed = zlib.gunzipSync(compressed).toString("utf8");
  return JSON.parse(decompressed);
}

/**
 * Fallback to Miruro pipe for episode & stream extraction when native providers fail.
 */
export async function resolveViaMiruroFallback(anilistId, audio = "sub", epNum = 1) {
  for (const domain of MIRURO_DOMAINS) {
    try {
      const headers = {
        "User-Agent": UA,
        Referer: `${domain}/watch?id=${anilistId}&ep=${epNum}`,
        Origin: domain,
      };

      const epData = await miruroPipeRequest(domain, `episodes?anilistId=${anilistId}`, headers);
      const providersObj = epData?.providers;
      if (!providersObj || typeof providersObj !== "object") continue;

      for (const [provName, provInfo] of Object.entries(providersObj)) {
        const epList = provInfo?.episodes?.[audio] || provInfo?.episodes?.sub;
        if (!Array.isArray(epList) || !epList.length) continue;

        const targetEp =
          epList.find((e) => Number(e?.number) === Number(epNum)) || epList[0];
        if (!targetEp?.id) continue;

        const cat = provInfo?.meta?.category || "embedded";
        const srcPath = `sources?episodeId=${encodeURIComponent(targetEp.id)}&provider=${encodeURIComponent(provName)}&category=${encodeURIComponent(cat)}`;
        const srcData = await miruroPipeRequest(domain, srcPath, headers);
        const streams = Array.isArray(srcData?.streams) ? srcData.streams : [];
        if (!streams.length) continue;

        const normalized = normalizeAnivexaWatchPayload(
          {
            streams: streams.map((s) => ({
              url: s.url || s.file,
              type: s.type || (String(s.url || "").includes(".m3u8") ? "hls" : "mp4"),
              referer: s.referer || `${domain}/`,
              subtitles: srcData?.subtitles || srcData?.tracks || [],
            })),
            subtitles: srcData?.subtitles || srcData?.tracks || [],
          },
          `miruro:${provName}`
        );

        if (normalized && normalized.streams.length > 0) {
          return normalized;
        }
      }
    } catch {
      // Try next Miruro mirror
    }
  }
  return null;
}
