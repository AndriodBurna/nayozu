import crypto from "crypto";

export const PROXY_SECRET =
  process.env.ANIMESDK_SIGN_SECRET || "nayozu-anime-sdk-hmac-key";

/**
 * Strict allowlist of upstream provider and CDN hostnames to prevent open-proxy abuse.
 */
export const ALLOWED_PROXY_HOSTS: readonly string[] = [
  "animeparadise.moe",
  "stream.animeparadise.moe",
  "api.animeparadise.moe",
  "allmanga.to",
  "allanime.day",
  "api.allanime.day",
  "anikoto.moe",
  "anikototv.to",
  "anikotoapi.site",
  "gogoanime3.co",
  "megaplay.buzz",
  "megaplay.moe",
  "mp4upload.com",
  "anifast.stream",
  "bunnycdn.ru",
];

/**
 * Computes an HMAC-SHA256 signature for a target URL and optional encoded headers.
 */
export function computeProxySignature(
  targetUrl: string,
  hParam?: string | null,
  secret = PROXY_SECRET
): string {
  const h = crypto.createHmac("sha256", secret);
  h.update(targetUrl);
  if (hParam) h.update("|h=" + hParam);
  return h.digest("hex");
}

/**
 * Timing-safe string comparison to prevent timing attacks on HMAC signatures.
 */
export function timingSafeEquals(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks whether a target URL's hostname belongs to the allowed hostnames.
 */
export function isAllowedProxyHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ALLOWED_PROXY_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

/**
 * Safely extracts only the hostname from a URL for sanitized logging without secrets or query parameters.
 */
export function getSanitizedHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "invalid-url";
  }
}

/**
 * Constructs a signed proxy URL.
 */
export function buildSignedProxyUrl(
  proxyBase: string,
  targetUrl: string,
  hParam?: string | null,
  secret = PROXY_SECRET
): string {
  const parts = [`url=${encodeURIComponent(targetUrl)}`];
  if (hParam) parts.push(`h=${encodeURIComponent(hParam)}`);
  if (secret) parts.push(`sig=${computeProxySignature(targetUrl, hParam, secret)}`);
  return `${proxyBase}?${parts.join("&")}`;
}

/**
 * Rewrites all variant playlists, iframe playlists, encryption keys, and chunk URLs
 * in an M3U8 manifest through the proxy with valid HMAC signatures.
 */
export function rewriteHlsManifest(
  manifest: string,
  baseUrl: string,
  proxyBase: string,
  hParam?: string | null,
  secret = PROXY_SECRET
): string {
  const wrap = (uri: string) => {
    try {
      const abs = new URL(uri, baseUrl).href;
      return buildSignedProxyUrl(proxyBase, abs, hParam, secret);
    } catch {
      return uri;
    }
  };

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Rewrite URI attributes in tags such as #EXT-X-KEY, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-MEDIA
        return trimmed.replace(
          /URI=(["'])(.*?)\1/g,
          (_, quote, uri) => `URI=${quote}${wrap(uri)}${quote}`
        );
      }
      // Non-comment line is a sub-playlist or segment chunk URL
      return wrap(trimmed);
    })
    .join("\n");
}

export interface MinimalStreamData {
  type: "video";
  streams: Array<{
    sourceUrl: string;
    isHLS?: boolean;
    quality?: string;
    language?: string;
    headers?: Record<string, string>;
    subtitles?: Array<{
      url: string;
      label: string;
      language: string;
      format?: string;
      default?: boolean;
    }>;
  }>;
}

/**
 * Normalizes all stream source URLs and subtitle URLs to route through the
 * same-origin Next.js proxy route with valid HMAC signatures.
 */
export function rewriteStreamToSameOriginProxy<T extends MinimalStreamData>(
  stream: T,
  proxyBase = "/api/anime-sdk/proxy"
): T {
  return {
    ...stream,
    streams: stream.streams.map((s) => {
      let targetUrl = s.sourceUrl;
      let hParam: string | null = null;
      try {
        if (s.sourceUrl.includes("/proxy?")) {
          const parsed = new URL(s.sourceUrl, "http://localhost");
          targetUrl = parsed.searchParams.get("url") || targetUrl;
          hParam = parsed.searchParams.get("h");
        } else if (s.headers && Object.keys(s.headers).length > 0) {
          hParam = Buffer.from(JSON.stringify(s.headers)).toString("base64");
        }
      } catch {
        // Fallback to original
      }

      const sourceUrl = buildSignedProxyUrl(proxyBase, targetUrl, hParam, PROXY_SECRET);

      const subtitles = s.subtitles?.map((sub) => {
        let subTarget = sub.url;
        let subH: string | null = hParam;
        try {
          if (sub.url.includes("/proxy?")) {
            const parsed = new URL(sub.url, "http://localhost");
            subTarget = parsed.searchParams.get("url") || subTarget;
            subH = parsed.searchParams.get("h") || hParam;
          }
        } catch {
          // Fallback to original
        }

        return {
          ...sub,
          url: buildSignedProxyUrl(proxyBase, subTarget, subH, PROXY_SECRET),
        };
      });

      return {
        ...s,
        sourceUrl,
        ...(subtitles ? { subtitles } : {}),
      };
    }),
  };
}
