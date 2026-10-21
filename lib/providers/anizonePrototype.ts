/**
 * AniZone Isolated Streaming Prototype (TypeScript)
 *
 * This module is an isolated research prototype for resolving and parsing
 * anime streams from anizone.to.
 *
 * Code reference: Adapted from yuzono/anime-extensions (Apache 2.0 License).
 *
 * LEGAL & ARCHITECTURAL NOTICE:
 * - The Apache 2.0 license applies ONLY to the client extension / scraper source code.
 * - The Apache 2.0 license DOES NOT grant distribution, copyright, or streaming rights
 *   for the third-party anime content hosted on anizone.to or seiryuu.vid-cdn.xyz.
 * - This prototype is isolated and does NOT modify Nayozu's production player
 *   or media provider adapter.
 */

import https from 'node:https';

export interface AniZoneSearchItem {
  slug: string;
  url: string;
  cover: string;
  main_title: string;
  title_list?: Record<string, string>;
}

export interface AniZoneSubtitle {
  title: string;
  format?: string;
  language?: string;
  default?: boolean;
  forced?: string;
  file: string;
}

export interface AniZoneVidstackConfig {
  src: string;
  subtitles?: AniZoneSubtitle[];
  storyboard?: string;
  chapter?: string;
}

export interface AniZoneResolvedStream {
  slug: string;
  episode: number;
  hlsUrl: string;
  subtitles: AniZoneSubtitle[];
  referer: string;
}

export interface AniZoneProbeResult {
  masterStatus: number;
  variants: string[];
  encryptionKeyHeader?: string;
  requiresReferer: boolean;
  sampleVideoChunkStatus?: number;
  sampleVideoChunkBytes?: number;
}

const ANIZONE_BASE = 'https://anizone.to';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Robust HTTP client using Node's https module with IPv4 preference and retry
 */
function fetchHttp(
  urlStr: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const req = https.request(
        u,
        {
          method: 'GET',
          family: 4, // Prevent IPv6 connect timeout stalls on Windows
          headers: {
            'User-Agent': DEFAULT_UA,
            ...options.headers,
          },
          timeout: options.timeoutMs || 15000,
        },
        (res) => {
          let chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection to ${u.hostname} timed out.`));
      });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Decode JSON string arguments embedded in Alpine.js / Vidstack attributes.
 * Replaces unicode escaped characters, unescapes slashes and quotes.
 */
function decodeEscapedJson(raw: string): string {
  return raw
    .replace(/\\u0022/g, '"')
    .replace(/\\u0026/g, '&')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/');
}

/**
 * Search AniZone catalog for an anime title.
 */
export async function searchAniZone(query: string): Promise<AniZoneSearchItem[]> {
  const url = `${ANIZONE_BASE}/anime?search=${encodeURIComponent(query)}`;
  const res = await fetchHttp(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (res.status !== 200) {
    throw new Error(`AniZone search failed with HTTP ${res.status}`);
  }

  // Pattern matches the Alpine.js items JSON definition in the page
  const match = res.body.match(/x-data="[^"]*items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if (!match) {
    return [];
  }

  try {
    const jsonStr = decodeEscapedJson(match[1]);
    const items = JSON.parse(jsonStr) as AniZoneSearchItem[];
    return items.map((item) => ({
      ...item,
      url: item.url.replace(/\\\//g, '/'),
      cover: item.cover.replace(/\\\//g, '/'),
    }));
  } catch (err) {
    console.warn('[AniZonePrototype] Search JSON parse failed:', err);
    return [];
  }
}

/**
 * Extract Vidstack player configuration from an episode page.
 */
export async function getAniZoneEpisodeStream(
  slug: string,
  episode: number
): Promise<AniZoneResolvedStream> {
  const pageUrl = `${ANIZONE_BASE}/anime/${slug}/${episode}`;
  const res = await fetchHttp(pageUrl, {
    headers: {
      Referer: `${ANIZONE_BASE}/anime/${slug}`,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (res.status !== 200) {
    throw new Error(`AniZone episode fetch failed with HTTP ${res.status}`);
  }

  // Match the vidstackPlayer initialization snippet
  const match = res.body.match(/vidstackPlayer\s*\(\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)\s*\)/i);
  if (!match) {
    throw new Error(`vidstackPlayer configuration payload not found in AniZone episode page.`);
  }

  const jsonStr = decodeEscapedJson(match[1]);
  const config = JSON.parse(jsonStr) as AniZoneVidstackConfig;

  if (!config.src) {
    throw new Error(`AniZone configuration has no master stream source URL.`);
  }

  const cleanSrc = config.src.replace(/\\\//g, '/');
  const cleanSubs: AniZoneSubtitle[] = (config.subtitles || []).map((sub) => ({
    ...sub,
    file: sub.file.replace(/\\\//g, '/'),
  }));

  return {
    slug,
    episode,
    hlsUrl: cleanSrc,
    subtitles: cleanSubs,
    referer: `${ANIZONE_BASE}/anime/${slug}/${episode}`,
  };
}

/**
 * Probe the HLS master playlist, variant playlists, encryption key, and video chunks.
 */
export async function probeAniZoneHLS(stream: AniZoneResolvedStream): Promise<AniZoneProbeResult> {
  // Probe master playlist with required Referer
  const masterRes = await fetchHttp(stream.hlsUrl, {
    headers: {
      Referer: `${ANIZONE_BASE}/`,
      Origin: ANIZONE_BASE,
    },
  });

  if (masterRes.status !== 200) {
    return {
      masterStatus: masterRes.status,
      variants: [],
      requiresReferer: true,
    };
  }

  const variantLines = masterRes.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const variants = variantLines.map((v) => new URL(v, stream.hlsUrl).toString());

  let encryptionKeyHeader: string | undefined;
  let sampleVideoChunkStatus: number | undefined;
  let sampleVideoChunkBytes: number | undefined;

  // Probe first variant playlist
  if (variants.length > 0) {
    const levelRes = await fetchHttp(variants[0], {
      headers: {
        Referer: `${ANIZONE_BASE}/`,
        Origin: ANIZONE_BASE,
      },
    });

    if (levelRes.status === 200) {
      const levelManifest = levelRes.body;
      const keyLine = levelManifest.split('\n').find((l) => l.startsWith('#EXT-X-KEY'));
      if (keyLine) {
        encryptionKeyHeader = keyLine.trim();
      }

      // Probe first video segment chunk
      const segLine = levelManifest
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'));

      if (segLine) {
        const segUrl = new URL(segLine, variants[0]).toString();
        const segRes = await fetchHttp(segUrl, {
          headers: {
            Referer: `${ANIZONE_BASE}/`,
            Origin: ANIZONE_BASE,
          },
        });
        sampleVideoChunkStatus = segRes.status;
        sampleVideoChunkBytes = segRes.body.length;
      }
    }
  }

  return {
    masterStatus: masterRes.status,
    variants,
    encryptionKeyHeader,
    requiresReferer: true,
    sampleVideoChunkStatus,
    sampleVideoChunkBytes,
  };
}
