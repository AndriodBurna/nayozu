import crypto from "crypto";

export const PROXY_SECRET =
  process.env.ANIMESDK_SIGN_SECRET || "nayozu-anime-sdk-hmac-key";

/**
 * Known upstream provider and CDN hostnames.
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
  "anineko.to",
  "anizone.to",
  "seiryuu.vid-cdn.xyz",
  "vid-cdn.xyz",
  "reanime.to",
  "flixcloud.cc",
  "aniwaves.ru",
  "krussdomi.com",
  "kickassanime.mx",
  "kaast1.com",
  "animegg.org",
  "mkissa.to",
  "mkissa.net",
  "animeonsen.xyz",
  "senshi.live",
  "anime-dunya.com",
  "echovideo.ru",
  "upn.one",
  "vidmoly.net",
  "vidcloud.se",
  "miruro.ru",
  "miruro.bz",
  "miruro.online",
];

/**
 * Checks whether a hostname is a loopback, link-local, or private RFC1918 address (SSRF protection).
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc00:") ||
    host.startsWith("fd00:")
  ) {
    return true;
  }

  // IPv4 numeric check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }

  return false;
}

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
 * Checks whether a target URL is a valid public HTTP/HTTPS URL safe for signed proxying.
 * Blocks private/loopback/local IP ranges (SSRF protection) while allowing known and dynamic CDNs.
 */
export function isAllowedProxyHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) {
      return false;
    }
    if (
      ALLOWED_PROXY_HOSTS.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`)
      )
    ) {
      return true;
    }
    // Allow signed public CDN domains (must have a valid public TLD dot)
    return host.includes(".");
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

/**
 * Decrypts a FlixCloud Base64+XOR encrypted HLS manifest if it does not already start with #EXTM3U.
 */
export function decryptFlixCloudManifest(
  rawTextOrBuffer: string | Buffer,
  playlistKey?: string | null
): string {
  const text =
    typeof rawTextOrBuffer === "string"
      ? rawTextOrBuffer.trim()
      : rawTextOrBuffer.toString("utf8").trim();

  if (text.startsWith("#EXTM3U") || !playlistKey) {
    return text;
  }

  try {
    const key = Buffer.from(playlistKey, "base64");
    if (!key.length) return text;
    const payload = Buffer.from(text, "base64");
    const out = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      out[i] = payload[i] ^ key[i % key.length];
    }
    const decoded = out.toString("utf8").trim();
    if (decoded.startsWith("#EXTM3U")) {
      return decoded;
    }
  } catch {
    // Fallback to raw text
  }
  return text;
}

const FLIX_IMAGE_SEGMENT_XOR_KEY = Uint8Array.from([
  157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197,
]);

/**
 * Unwraps FlixCloud HD-2 PNG/WebP-disguised MPEG-TS segments.
 */
export function unwrapFlixImageSegment(bodyBuffer: Buffer): {
  body: Buffer;
  unwrapped: boolean;
} {
  let offset = 0;
  let needsXor = false;

  const isWebp =
    bodyBuffer.length > 12 &&
    bodyBuffer[0] === 0x52 &&
    bodyBuffer[1] === 0x49 &&
    bodyBuffer[2] === 0x46 &&
    bodyBuffer[3] === 0x46 &&
    bodyBuffer[8] === 0x57 &&
    bodyBuffer[9] === 0x45 &&
    bodyBuffer[10] === 0x42 &&
    bodyBuffer[11] === 0x50;

  const isPng =
    bodyBuffer.length > 8 &&
    bodyBuffer[0] === 0x89 &&
    bodyBuffer[1] === 0x50 &&
    bodyBuffer[2] === 0x4e &&
    bodyBuffer[3] === 0x47 &&
    bodyBuffer[4] === 0x0d &&
    bodyBuffer[5] === 0x0a &&
    bodyBuffer[6] === 0x1a &&
    bodyBuffer[7] === 0x0a;

  if (isWebp) {
    offset = 12;
    needsXor = bodyBuffer[offset] !== 0x47;
  } else if (isPng) {
    offset = 8;
    needsXor = bodyBuffer[offset] !== 0x47;
  }

  if (!offset) return { body: bodyBuffer, unwrapped: false };

  const out = Buffer.from(bodyBuffer.subarray(offset));
  if (needsXor) {
    for (let i = 0; i < out.length; i++) {
      out[i] ^= FLIX_IMAGE_SEGMENT_XOR_KEY[i % FLIX_IMAGE_SEGMENT_XOR_KEY.length];
    }
  }

  return { body: out, unwrapped: true };
}

export interface MinimalStreamData {
  type: "video";
  streams: Array<{
    sourceUrl: string;
    isHLS?: boolean;
    quality?: string;
    language?: string;
    headers?: Record<string, string>;
    playlistKey?: string | null;
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
        } else {
          const payloadObj: Record<string, string> = {
            ...(s.headers || {}),
          };
          if (s.playlistKey) {
            payloadObj.__flixKey = s.playlistKey;
          }
          if (Object.keys(payloadObj).length > 0) {
            hParam = Buffer.from(JSON.stringify(payloadObj)).toString("base64");
          }
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
