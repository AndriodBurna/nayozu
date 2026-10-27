import { NextRequest, NextResponse } from "next/server";
import { resolveAnimeStream } from "@/lib/services/animeSdkService";
import { ENABLE_ANIMESDK } from "@/lib/features";

export async function GET(request: NextRequest) {
  if (!ENABLE_ANIMESDK) {
    return NextResponse.json(
      { success: false, error: "AnimeSDK is currently disabled via feature flag." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "";
  const anilistId = searchParams.get("anilistId");
  const provider = searchParams.get("provider") || "auto";
  const episodeStr = searchParams.get("episode");
  const episodeNumber = episodeStr ? parseInt(episodeStr, 10) : 1;
  const language = searchParams.get("language") || "sub";

  if (!title && !anilistId) {
    return NextResponse.json(
      { success: false, error: "Missing required 'title' or 'anilistId' query parameter." },
      { status: 400 }
    );
  }

  try {
    const result = await resolveAnimeStream({
      title: title || String(anilistId),
      anilistId,
      provider,
      episodeNumber: isNaN(episodeNumber) ? 1 : episodeNumber,
      language,
    });

    const status = result.success ? 200 : result.isServerDown ? 503 : 502;
    return NextResponse.json(result, { status });
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
