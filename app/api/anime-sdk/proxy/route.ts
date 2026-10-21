import { NextRequest, NextResponse } from "next/server";
import {
  computeProxySignature,
  timingSafeEquals,
  isAllowedProxyHost,
  getSanitizedHost,
  rewriteHlsManifest,
  PROXY_SECRET,
} from "@/lib/services/animeSdkProxy";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Range, Accept, Content-Type, Authorization, Origin",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const hParam = searchParams.get("h");
  const sig = searchParams.get("sig");
  const ctOverride = searchParams.get("ct");

  // 1. Validate URL param
  if (!targetUrl) {
    return NextResponse.json({ error: "Missing required 'url' parameter" }, { status: 400 });
  }

  const sanitizedHost = getSanitizedHost(targetUrl);

  // 2. Enforce host allowlist (SSRF protection)
  if (!isAllowedProxyHost(targetUrl)) {
    console.warn(`[Proxy] 403 Forbidden: Host [${sanitizedHost}] not in allowed hosts`);
    return NextResponse.json(
      { error: `Target host ${sanitizedHost} not permitted` },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // 3. Enforce HMAC signature check
  const expectedSig = computeProxySignature(targetUrl, hParam, PROXY_SECRET);
  if (!sig || !timingSafeEquals(sig, expectedSig)) {
    console.warn(`[Proxy] 401 Unauthorized: Invalid or missing HMAC signature for host [${sanitizedHost}]`);
    return NextResponse.json(
      { error: "Invalid or missing proxy signature" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  // 4. Construct upstream headers
  const upstreamHeaders: Record<string, string> = {
    Accept: "*/*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
  };

  if (hParam) {
    try {
      const parsed = JSON.parse(Buffer.from(hParam, "base64").toString("utf8"));
      Object.assign(upstreamHeaders, parsed);
    } catch {
      // Ignored malformed hParam
    }
  }

  const range = request.headers.get("range");
  if (range) {
    upstreamHeaders["Range"] = range;
  }

  // 5. Fetch from upstream provider
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Proxy] Upstream fetch failure (${msg}) for host [${sanitizedHost}]`);
    return NextResponse.json(
      { error: `Upstream fetch failed: ${msg}` },
      { status: 502, headers: CORS_HEADERS }
    );
  }

  if (!upstream.ok) {
    console.warn(`[Proxy] Upstream failure (HTTP ${upstream.status}) from host [${sanitizedHost}]`);
    return new Response(`Upstream returned ${upstream.status}`, {
      status: upstream.status === 404 ? 404 : 502,
      headers: CORS_HEADERS,
    });
  }

  const ct = upstream.headers.get("content-type") || "";
  const cleanUrl = targetUrl.split("?")[0].toLowerCase();
  const isHls =
    ct.toLowerCase().includes("mpegurl") ||
    cleanUrl.endsWith(".m3u8");

  // Determine current proxy base URL
  const origin = new URL(request.url).origin;
  const proxyBase = `${origin}/api/anime-sdk/proxy`;

  // 6. Handle HLS manifest rewriting with valid HMAC signatures on all child variants & chunks
  if (isHls) {
    const rawManifest = await upstream.text();
    const rewritten = rewriteHlsManifest(
      rawManifest,
      targetUrl,
      proxyBase,
      hParam,
      PROXY_SECRET
    );

    return new Response(rewritten, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 7. Non-HLS responses (video segments, subtitle tracks, fonts, etc.)
  let contentType = ctOverride || ct || "application/octet-stream";
  if (!ctOverride) {
    if (cleanUrl.endsWith(".vtt") || cleanUrl.includes("/captions") || cleanUrl.includes("captions?")) {
      contentType = "text/vtt";
    } else if (cleanUrl.endsWith(".ts") || cleanUrl.includes("/ts")) {
      contentType = "video/mp2t";
    } else if (cleanUrl.endsWith(".mp4")) {
      contentType = "video/mp4";
    }
  }

  const responseHeaders: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": contentType,
  };

  const cl = upstream.headers.get("content-length");
  if (cl) responseHeaders["Content-Length"] = cl;

  const cr = upstream.headers.get("content-range");
  if (cr) responseHeaders["Content-Range"] = cr;

  const ar = upstream.headers.get("accept-ranges");
  responseHeaders["Accept-Ranges"] = ar || "bytes";

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
