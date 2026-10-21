import { NextRequest, NextResponse } from "next/server";
import { searchSdkProvider, fetchSdkEpisodes } from "@/lib/services/animeSdkService";
import { ENABLE_ANIMESDK } from "@/lib/features";

export async function GET(request: NextRequest) {
  if (!ENABLE_ANIMESDK) {
    return NextResponse.json(
      { success: false, error: "AnimeSDK is currently disabled via feature flag." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const provider = searchParams.get("provider") || "animeparadise";
  const mediaId = searchParams.get("mediaId");

  if (mediaId) {
    try {
      const episodes = await fetchSdkEpisodes(provider, mediaId);
      return NextResponse.json({ success: true, episodes });
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  if (!q) {
    return NextResponse.json(
      { success: false, error: "Missing required 'q' query parameter." },
      { status: 400 }
    );
  }

  try {
    const results = await searchSdkProvider(provider, q);
    return NextResponse.json({ success: true, results });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
