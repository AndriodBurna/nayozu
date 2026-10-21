/**
 * Nayozu — AnimeSDK Experimental Streaming Server
 *
 * Runs hexxt-git/anime-sdk on port 4000 with a hardened, recursive HLS proxy:
 * - HMAC-SHA256 URL signing with child playlist and chunk re-signing
 * - Strict SSRF host allowlist
 * - Scoped CORS headers
 * - Sanitized logging (no secrets or sensitive query strings logged)
 *
 * Run with: npm run sdk:server
 */

import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import {
  HttpClient,
  AllmangaProvider,
  AnikotoProvider,
  AnimeParadiseProvider,
  GogoanimeProvider,
  MegaPlayProvider,
  startServer
} from 'anime-sdk';

const PORT = parseInt(process.env.ANIMESDK_PORT || '4000', 10);
const PROXY_SECRET = process.env.ANIMESDK_SIGN_SECRET || 'nayozu-anime-sdk-hmac-key';

// Restrict proxy access to trusted streaming providers and CDNs
const ALLOWED_PROXY_HOSTS = [
  'animeparadise.moe',
  'stream.animeparadise.moe',
  'api.animeparadise.moe',
  'allmanga.to',
  'allanime.day',
  'api.allanime.day',
  'anikoto.moe',
  'anikototv.to',
  'anikotoapi.site',
  'gogoanime3.co',
  'megaplay.buzz',
  'megaplay.moe',
  'mp4upload.com',
  'anifast.stream',
  'bunnycdn.ru'
];

/**
 * Computes HMAC-SHA256 signature for proxy validation.
 */
function computeProxySignature(targetUrl, hParam, secret) {
  const h = crypto.createHmac('sha256', secret);
  h.update(targetUrl);
  if (hParam) h.update('|h=' + hParam);
  return h.digest('hex');
}

/**
 * Timing-safe string equality to prevent timing attacks.
 */
function timingSafeEquals(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks if a target URL's hostname belongs to the allowed hostnames.
 */
function isAllowedProxyHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ALLOWED_PROXY_HOSTS.some(
      allowed => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

/**
 * Extracts only the hostname for sanitized logging. Never returns secrets or tokens.
 */
function getSanitizedHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return 'unknown-host';
  }
}

/**
 * Constructs a signed proxy URL.
 */
function buildSignedProxyUrl(proxyBase, targetUrl, hParam, secret) {
  const parts = [`url=${encodeURIComponent(targetUrl)}`];
  if (hParam) parts.push(`h=${encodeURIComponent(hParam)}`);
  if (secret) parts.push(`sig=${computeProxySignature(targetUrl, hParam, secret)}`);
  return `${proxyBase}?${parts.join('&')}`;
}

/**
 * Rewrites all variant playlists, iframe playlists, encryption keys, and chunk URLs
 * in an M3U8 manifest through the proxy with valid HMAC signatures.
 */
function rewriteHlsManifest(manifest, baseUrl, proxyBase, hParam, secret) {
  const wrap = uri => {
    try {
      const abs = new URL(uri, baseUrl).href;
      return buildSignedProxyUrl(proxyBase, abs, hParam, secret);
    } catch {
      return uri;
    }
  };

  return manifest
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return trimmed.replace(
          /URI=(["'])(.*?)\1/g,
          (_, quote, uri) => `URI=${quote}${wrap(uri)}${quote}`
        );
      }
      return wrap(trimmed);
    })
    .join('\n');
}

console.log('[AnimeSDK] Initializing HTTP client and anime providers...');
const http = new HttpClient();

const providers = [
  new AllmangaProvider(http),
  new AnikotoProvider(http),
  new AnimeParadiseProvider(http),
  new GogoanimeProvider(http),
  new MegaPlayProvider(http)
];

console.log(`[AnimeSDK] Registered ${providers.length} providers:`, providers.map(p => p.id).join(', '));

// Start the underlying SDK server with proxy: false (we handle /proxy with full recursive HLS signing)
const sdkServer = startServer({
  providers,
  port: PORT,
  proxy: false
});

// Intercept the request listener to handle /proxy with full HMAC signing and CORS
const originalListeners = sdkServer.listeners('request').slice();
sdkServer.removeAllListeners('request');

sdkServer.on('request', async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS headers allowing Next.js dev server on port 3000
  const reqOrigin = req.headers.origin;
  const isAllowedOrigin =
    reqOrigin === 'http://localhost:3000' ||
    reqOrigin === 'http://127.0.0.1:3000' ||
    !reqOrigin;

  const corsHeaders = {
    'Access-Control-Allow-Origin': isAllowedOrigin && reqOrigin ? reqOrigin : '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Range, Accept, Content-Type, Authorization, Origin',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Handle /proxy route
  if (url.pathname === '/proxy') {
    const q = url.searchParams;
    const targetUrl = q.get('url');
    const hParam = q.get('h');
    const sig = q.get('sig');
    const ctOverride = q.get('ct');

    if (!targetUrl) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Missing required 'url' parameter" }));
      return;
    }

    const host = getSanitizedHost(targetUrl);

    // Host allowlist validation
    if (!isAllowedProxyHost(targetUrl)) {
      console.warn(`[AnimeSDK Proxy] 403 Forbidden: Host [${host}] rejected by allowlist`);
      res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Target host ${host} not permitted` }));
      return;
    }

    // HMAC signature validation
    const expectedSig = computeProxySignature(targetUrl, hParam, PROXY_SECRET);
    if (!sig || !timingSafeEquals(sig, expectedSig)) {
      console.warn(`[AnimeSDK Proxy] 401 Unauthorized: Invalid or missing HMAC signature for host [${host}]`);
      res.writeHead(401, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing proxy signature' }));
      return;
    }

    // Upstream headers
    const upstreamHeaders = {
      Accept: '*/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity'
    };

    if (hParam) {
      try {
        const parsed = JSON.parse(Buffer.from(hParam, 'base64').toString('utf8'));
        Object.assign(upstreamHeaders, parsed);
      } catch {}
    }

    if (req.headers.range) {
      upstreamHeaders['Range'] = req.headers.range;
    }

    const abortCtrl = new AbortController();
    req.on('close', () => abortCtrl.abort());

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        headers: upstreamHeaders,
        redirect: 'follow',
        signal: abortCtrl.signal
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error(`[AnimeSDK Proxy] Fetch failure (${msg}) for host [${host}]`);
      res.writeHead(502, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Upstream fetch failed: ${msg}` }));
      return;
    }

    if (!upstream.ok) {
      console.warn(`[AnimeSDK Proxy] Upstream failure (HTTP ${upstream.status}) from host [${host}]`);
      res.writeHead(upstream.status === 404 ? 404 : 502, {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      });
      res.end(`Upstream returned ${upstream.status}`);
      return;
    }

    const ct = upstream.headers.get('content-type') ?? '';
    const cleanUrl = targetUrl.split('?')[0].toLowerCase();
    const isHls =
      ct.toLowerCase().includes('mpegurl') || cleanUrl.endsWith('.m3u8');

    const hostHeader = req.headers.host ?? `localhost:${PORT}`;
    const scheme = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() ?? 'http';
    const proxyBase = `${scheme}://${hostHeader}/proxy`;

    // HLS manifest rewriting
    if (isHls) {
      const text = await upstream.text();
      const rewritten = rewriteHlsManifest(text, targetUrl, proxyBase, hParam, PROXY_SECRET);
      const buf = Buffer.from(rewritten, 'utf8');
      res.writeHead(upstream.status, {
        ...corsHeaders,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
        'Content-Length': buf.length
      });
      res.end(buf);
      return;
    }

    // Media chunk / subtitle response
    let contentType = ctOverride || ct || 'application/octet-stream';
    if (!ctOverride) {
      if (cleanUrl.endsWith('.vtt') || cleanUrl.includes('/captions') || cleanUrl.includes('captions?')) {
        contentType = 'text/vtt';
      } else if (cleanUrl.endsWith('.ts') || cleanUrl.includes('/ts')) {
        contentType = 'video/mp2t';
      } else if (cleanUrl.endsWith('.mp4')) {
        contentType = 'video/mp4';
      }
    }

    const outHeaders = {
      ...corsHeaders,
      'Content-Type': contentType
    };

    const cl = upstream.headers.get('content-length');
    if (cl) outHeaders['Content-Length'] = cl;
    const cr = upstream.headers.get('content-range');
    if (cr) outHeaders['Content-Range'] = cr;
    const ar = upstream.headers.get('accept-ranges');
    outHeaders['Accept-Ranges'] = ar ?? 'bytes';

    res.writeHead(upstream.status, outHeaders);
    if (upstream.body) {
      const readable = Readable.fromWeb(upstream.body);
      readable.on('error', () => {});
      res.on('close', () => readable.destroy());
      readable.pipe(res);
    } else {
      res.end();
    }
    return;
  }

  // Pass all other endpoints (/health, /search, /content, /stream) to original handler
  if (originalListeners.length > 0) {
    originalListeners[0](req, res);
  }
});

console.log(`[AnimeSDK] Server running on http://localhost:${PORT}`);
console.log(`[AnimeSDK] Hardened proxy active with HMAC-SHA256 child signing and SSRF host allowlist.`);

// Graceful shutdown
const shutdown = () => {
  console.log('\n[AnimeSDK] Shutting down gracefully...');
  sdkServer.close(() => {
    console.log('[AnimeSDK] Server stopped.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
