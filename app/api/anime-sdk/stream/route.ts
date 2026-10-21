import { NextRequest, NextResponse } from "next/server";
import { resolveSdkStream } from "@/lib/services/animeSdkService";
import { rewriteStreamToSameOriginProxy } from "@/lib/services/animeSdkProxy";
import { ENABLE_ANIMESDK } from "@/lib/features";

export async function GET(request: NextRequest) {
  if (!ENABLE_ANIMESDK) {
    return NextResponse.json(
      { success: false, error: "AnimeSDK is currently disabled via feature flag." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const unitId = searchParams.get("unitId");
  const language = searchParams.get("language") || "sub";

  if (!provider || !unitId) {
    return NextResponse.json(
      { success: false, error: "Missing required 'provider' or 'unitId' query parameters." },
      { status: 400 }
    );
  }

  try {
    const rawStream = await resolveSdkStream(provider, unitId, language);
    const stream = rewriteStreamToSameOriginProxy(rawStream, "/api/anime-sdk/proxy");
    return NextResponse.json({ success: true, stream });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
