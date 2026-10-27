/**
 * Nayozu — Unified Anime Streaming Server (AnimeSDK + Anivexa API + Kuhi Race & Miruro Fallback)
 *
 * Runs on port 4000 (configurable via ANIMESDK_PORT) and mounts:
 * 1. Anivexa 14-provider engine (/map/:id, /episodes/:id, /watch/:provider/:id/:audio/:ep)
 * 2. Kuhi concurrent provider race + EMA latency ranking (/race/:id/:audio/:ep, /extract/:query, /providers/status)
 * 3. AnimeSDK legacy endpoints (/search, /content, /stream)
 * 4. Hardened HMAC-SHA256 HLS/segment proxy (/proxy) with FlixCloud decryption & SSRF protection
 *
 * Run with: npm run sdk:server
 */

import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  HttpClient,
  AllmangaProvider,
  AnikotoProvider,
  AnimeParadiseProvider,
  GogoanimeProvider,
  MegaPlayProvider,
  startServer,
} from "anime-sdk";
import anivexaApi from "../Anivexa-API-main/index.js";
import {
  raceWatch,
  getMergedEpisodes,
  getProvidersStatus,
  resolveAnilistQuery,
  resolveViaMiruroFallback,
  RACE_PROVIDER_ORDER,
} from "../Anivexa-API-main/kuhi-race.js";

const PORT = parseInt(process.env.ANIMESDK_PORT || "4000", 10);
const PROXY_SECRET =
  process.env.ANIMESDK_SIGN_SECRET || "nayozu-anime-sdk-hmac-key";

const FLIX_IMAGE_SEGMENT_XOR_KEY = Uint8Array.from([
  157, 42, 241, 71, 179, 142, 92, 112, 166, 25, 228, 59, 216, 98, 15, 197,
]);

/**
 * Checks whether a hostname is a loopback, link-local, or private RFC1918 address (SSRF protection).
 */
function isPrivateOrLoopbackHost(hostname) {
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
 * Computes HMAC-SHA256 signature for proxy validation.
 */
function computeProxySignature(targetUrl, hParam, secret) {
  const h = crypto.createHmac("sha256", secret);
  h.update(targetUrl);
  if (hParam) h.update("|h=" + hParam);
  return h.digest("hex");
}

/**
 * Timing-safe string equality to prevent timing attacks.
 */
function timingSafeEquals(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks if a target URL is a valid public HTTP/HTTPS URL safe for signed proxying.
 */
function isAllowedProxyHost(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) {
      return false;
    }
    return host.includes(".");
  } catch {
    return false;
  }
}

/**
 * Extracts only the hostname for sanitized logging.
 */
function getSanitizedHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "unknown-host";
  }
}

/**
 * Constructs a signed proxy URL.
 */
function buildSignedProxyUrl(proxyBase, targetUrl, hParam, secret) {
  const parts = [`url=${encodeURIComponent(targetUrl)}`];
  if (hParam) parts.push(`h=${encodeURIComponent(hParam)}`);
  if (secret) parts.push(`sig=${computeProxySignature(targetUrl, hParam, secret)}`);
  return `${proxyBase}?${parts.join("&")}`;
}

/**
 * Decrypts FlixCloud Base64+XOR manifest if needed.
 */
function decryptFlixCloudManifest(rawText, playlistKey) {
  const text = String(rawText || "").trim();
  if (text.startsWith("#EXTM3U") || !playlistKey) return text;
  try {
    const key = Buffer.from(playlistKey, "base64");
    if (!key.length) return text;
    const payload = Buffer.from(text, "base64");
    const out = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      out[i] = payload[i] ^ key[i % key.length];
    }
    const decoded = out.toString("utf8").trim();
    if (decoded.startsWith("#EXTM3U")) return decoded;
  } catch {}
  return text;
}

/**
 * Unwraps FlixCloud HD-2 PNG/WebP-wrapped MPEG-TS segments.
 */
function unwrapFlixImageSegment(bodyBuffer) {
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

/**
 * Rewrites all variant playlists, iframe playlists, encryption keys, and chunk URLs
 * in an M3U8 manifest through the proxy with valid HMAC signatures.
 */
function rewriteHlsManifest(manifest, baseUrl, proxyBase, hParam, secret) {
  const wrap = (uri) => {
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
        return trimmed.replace(
          /URI=(["'])(.*?)\1/g,
          (_, quote, uri) => `URI=${quote}${wrap(uri)}${quote}`
        );
      }
      return wrap(trimmed);
    })
    .join("\n");
}

function sendJson(res, status, data, corsHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

async function pipeWebResponse(webRes, res, corsHeaders = {}) {
  const headers = { ...corsHeaders };
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  headers["Content-Length"] = buf.length;
  res.writeHead(webRes.status, headers);
  res.end(buf);
}

console.log("[AnimeSDK] Initializing unified streaming engine (Anivexa + Kuhi Race + AnimeSDK)...");
const http = new HttpClient();

const sdkProviders = [
  new AllmangaProvider(http),
  new AnikotoProvider(http),
  new AnimeParadiseProvider(http),
  new GogoanimeProvider(http),
  new MegaPlayProvider(http),
];

console.log(
  `[AnimeSDK] Registered ${RACE_PROVIDER_ORDER.length} Anivexa/Kuhi providers (${RACE_PROVIDER_ORDER.join(", ")}) + ${sdkProviders.length} AnimeSDK providers (${sdkProviders.map((p) => p.id).join(", ")})`
);

const sdkServer = startServer({
  providers: sdkProviders,
  port: PORT,
  proxy: false,
});

const originalListeners = sdkServer.listeners("request").slice();
sdkServer.removeAllListeners("request");

sdkServer.on("request", async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  const reqOrigin = req.headers.origin;
  const isAllowedOrigin =
    reqOrigin === "http://localhost:3000" ||
    reqOrigin === "http://127.0.0.1:3000" ||
    !reqOrigin;

  const corsHeaders = {
    "Access-Control-Allow-Origin": isAllowedOrigin && reqOrigin ? reqOrigin : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Range, Accept, Content-Type, Authorization, Origin",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // 1. Unified Health Check
  if (pathname === "/health" || pathname === "/healthz") {
    sendJson(
      res,
      200,
      {
        status: "ok",
        name: "Nayozu Unified Anime Engine (Anivexa 2.2.1 + Kuhi Race + AnimeSDK)",
        uptime: Math.round(process.uptime()),
        anivexaProviders: RACE_PROVIDER_ORDER,
        sdkProviders: sdkProviders.map((p) => p.id),
        latencyRanking: getProvidersStatus().providers,
      },
      corsHeaders
    );
    return;
  }

  // 2. Kuhi Provider Latency Status
  if (pathname === "/providers/status") {
    sendJson(res, 200, getProvidersStatus(), corsHeaders);
    return;
  }

  // 3. Kuhi Concurrent Race Endpoint: GET /race/:anilistId/:audio/:ep?provider=...
  const raceMatch = pathname.match(/^\/race\/(\d+)\/(sub|dub)\/(\d+)\/?$/i);
  if (raceMatch) {
    const [, anilistId, audio, epStr] = raceMatch;
    const epNum = Number(epStr) || 1;
    const preferred = url.searchParams.get("provider");
    const onlyProvider =
      preferred && preferred !== "auto" && RACE_PROVIDER_ORDER.includes(preferred)
        ? preferred
        : null;

    try {
      let winner = await raceWatch(anilistId, audio.toLowerCase(), epNum, {
        preferredProvider: preferred,
        onlyProvider,
      });

      if (!winner && !onlyProvider) {
        winner = await resolveViaMiruroFallback(anilistId, audio.toLowerCase(), epNum);
      }

      if (!winner) {
        sendJson(
          res,
          404,
          { error: `No working streams found for AniList ${anilistId} ep ${epNum} (${audio})` },
          corsHeaders
        );
        return;
      }

      sendJson(res, 200, winner, corsHeaders);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || String(err) }, corsHeaders);
    }
    return;
  }

  // 4. Kuhi /extract/:query endpoint (supports title or AniList ID)
  const extractMatch = pathname.match(/^\/extract\/([^/]+)\/?$/i);
  if (extractMatch) {
    const rawQuery = decodeURIComponent(extractMatch[1]);
    const epParam = url.searchParams.get("ep");
    const audio = (url.searchParams.get("dub") === "true" || url.searchParams.get("audio") === "dub")
      ? "dub"
      : "sub";
    const provider = url.searchParams.get("provider");

    try {
      const resolved = await resolveAnilistQuery(rawQuery);
      const merged = await getMergedEpisodes(resolved.anilistId);

      if (epParam !== null) {
        const epNum = Number(epParam) || 1;
        let winner = await raceWatch(resolved.anilistId, audio, epNum, {
          preferredProvider: provider,
          onlyProvider:
            provider && provider !== "auto" && RACE_PROVIDER_ORDER.includes(provider)
              ? provider
              : null,
        });
        if (!winner) {
          winner = await resolveViaMiruroFallback(resolved.anilistId, audio, epNum);
        }
        sendJson(
          res,
          winner ? 200 : 404,
          {
            anilist_id: resolved.anilistId,
            title: resolved.title,
            episode: epNum,
            audio,
            provider: winner?.provider ?? null,
            streams: winner?.streams ?? [],
            subtitles: winner?.subtitles ?? [],
            episodes: merged.episodes,
          },
          corsHeaders
        );
        return;
      }

      sendJson(
        res,
        200,
        {
          anilist_id: resolved.anilistId,
          title: resolved.title,
          providers: merged.providers,
          episodes: merged.episodes,
        },
        corsHeaders
      );
    } catch (err) {
      sendJson(res, 500, { error: err?.message || String(err) }, corsHeaders);
    }
    return;
  }

  // 5. Anivexa Routes (/map/*, /episodes/*, /watch/*, /stream/reanime/*, /captcha/mkissa*)
  if (
    pathname.startsWith("/map/") ||
    pathname.startsWith("/episodes/") ||
    pathname.startsWith("/watch/") ||
    pathname.startsWith("/stream/reanime/") ||
    pathname.startsWith("/captcha/mkissa")
  ) {
    try {
      const webReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
      });
      const webRes = await anivexaApi.fetch(webReq);
      await pipeWebResponse(webRes, res, corsHeaders);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || String(err) }, corsHeaders);
    }
    return;
  }

  // 6. Hardened /proxy Route
  if (pathname === "/proxy") {
    const q = url.searchParams;
    const targetUrl = q.get("url");
    const hParam = q.get("h");
    const sig = q.get("sig");
    const ctOverride = q.get("ct");

    if (!targetUrl) {
      sendJson(res, 400, { error: "Missing required 'url' parameter" }, corsHeaders);
      return;
    }

    const host = getSanitizedHost(targetUrl);

    if (!isAllowedProxyHost(targetUrl)) {
      console.warn(`[AnimeSDK Proxy] 403 Forbidden: Host [${host}] rejected by SSRF guard`);
      sendJson(res, 403, { error: `Target host ${host} not permitted` }, corsHeaders);
      return;
    }

    const expectedSig = computeProxySignature(targetUrl, hParam, PROXY_SECRET);
    if (!sig || !timingSafeEquals(sig, expectedSig)) {
      console.warn(`[AnimeSDK Proxy] 401 Unauthorized: Invalid or missing HMAC signature for host [${host}]`);
      sendJson(res, 401, { error: "Invalid or missing proxy signature" }, corsHeaders);
      return;
    }

    const upstreamHeaders = {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
    };

    let flixKey = null;

    if (hParam) {
      try {
        const parsed = JSON.parse(Buffer.from(hParam, "base64").toString("utf8"));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.__flixKey === "string") {
            flixKey = parsed.__flixKey;
          }
          for (const [k, v] of Object.entries(parsed)) {
            if (k !== "__flixKey" && typeof v === "string") {
              upstreamHeaders[k] = v;
            }
          }
        }
      } catch {}
    }

    if (req.headers.range) {
      upstreamHeaders["Range"] = req.headers.range;
    }

    const abortCtrl = new AbortController();
    req.on("close", () => abortCtrl.abort());

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        headers: upstreamHeaders,
        redirect: "follow",
        signal: abortCtrl.signal,
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(`[AnimeSDK Proxy] Fetch failure (${msg}) for host [${host}]`);
      sendJson(res, 502, { error: `Upstream fetch failed: ${msg}` }, corsHeaders);
      return;
    }

    if (!upstream.ok) {
      console.warn(`[AnimeSDK Proxy] Upstream failure (HTTP ${upstream.status}) from host [${host}]`);
      res.writeHead(upstream.status === 404 ? 404 : 502, {
        ...corsHeaders,
        "Content-Type": "text/plain",
      });
      res.end(`Upstream returned ${upstream.status}`);
      return;
    }

    const ct = upstream.headers.get("content-type") ?? "";
    const cleanUrl = targetUrl.split("?")[0].toLowerCase();
    const isHls =
      ct.toLowerCase().includes("mpegurl") ||
      cleanUrl.endsWith(".m3u8") ||
      Boolean(flixKey && cleanUrl.includes("playlist"));

    const hostHeader = req.headers.host ?? `localhost:${PORT}`;
    const scheme = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim() ?? "http";
    const proxyBase = `${scheme}://${hostHeader}/proxy`;

    if (isHls) {
      const text = await upstream.text();
      const decrypted = decryptFlixCloudManifest(text, flixKey);
      const rewritten = rewriteHlsManifest(decrypted, targetUrl, proxyBase, hParam, PROXY_SECRET);
      const buf = Buffer.from(rewritten, "utf8");
      res.writeHead(upstream.status, {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
        "Content-Length": buf.length,
      });
      res.end(buf);
      return;
    }

    const mightBeFlixImageSegment =
      cleanUrl.endsWith(".png") ||
      cleanUrl.endsWith(".webp") ||
      ct.toLowerCase().includes("image/png") ||
      ct.toLowerCase().includes("image/webp");

    if (
      mightBeFlixImageSegment &&
      (flixKey || host.includes("flix") || upstreamHeaders.Referer?.includes("flix"))
    ) {
      const rawBuf = Buffer.from(await upstream.arrayBuffer());
      const { body, unwrapped } = unwrapFlixImageSegment(rawBuf);
      res.writeHead(upstream.status, {
        ...corsHeaders,
        "Content-Type": unwrapped ? "video/mp2t" : ct || "application/octet-stream",
        "Content-Length": body.length,
      });
      res.end(body);
      return;
    }

    let contentType = ctOverride || ct || "application/octet-stream";
    if (!ctOverride) {
      if (
        cleanUrl.endsWith(".vtt") ||
        cleanUrl.includes("/captions") ||
        cleanUrl.includes("captions?")
      ) {
        contentType = "text/vtt";
      } else if (cleanUrl.endsWith(".ts") || cleanUrl.includes("/ts")) {
        contentType = "video/mp2t";
      } else if (cleanUrl.endsWith(".mp4")) {
        contentType = "video/mp4";
      }
    }

    const outHeaders = {
      ...corsHeaders,
      "Content-Type": contentType,
    };

    const cl = upstream.headers.get("content-length");
    if (cl) outHeaders["Content-Length"] = cl;
    const cr = upstream.headers.get("content-range");
    if (cr) outHeaders["Content-Range"] = cr;
    const ar = upstream.headers.get("accept-ranges");
    outHeaders["Accept-Ranges"] = ar ?? "bytes";

    res.writeHead(upstream.status, outHeaders);
    if (upstream.body) {
      const readable = Readable.fromWeb(upstream.body);
      readable.on("error", () => {});
      res.on("close", () => readable.destroy());
      readable.pipe(res);
    } else {
      res.end();
    }
    return;
  }

  // 7. Pass all other endpoints (/search, /content, /stream) to AnimeSDK handler
  if (originalListeners.length > 0) {
    originalListeners[0](req, res);
  }
});

console.log(`[AnimeSDK] Unified server running on http://localhost:${PORT}`);
console.log(
  `[AnimeSDK] Active engines: Anivexa (14 providers) + Kuhi Race + Miruro Pipe + AnimeSDK (5 providers) + HMAC Proxy`
);

const shutdown = () => {
  console.log("\n[AnimeSDK] Shutting down gracefully...");
  sdkServer.close(() => {
    console.log("[AnimeSDK] Server stopped.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
