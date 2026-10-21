import { NextResponse } from "next/server";
import { checkSdkHealth, ANIMESDK_PROVIDERS } from "@/lib/services/animeSdkService";
import { ENABLE_ANIMESDK } from "@/lib/features";

export async function GET() {
  if (!ENABLE_ANIMESDK) {
    return NextResponse.json(
      { error: "AnimeSDK is currently disabled via feature flag." },
      { status: 403 }
    );
  }

  const health = await checkSdkHealth();

  const providers = ANIMESDK_PROVIDERS.map((p) => {
    if (p.id === "auto") {
      return {
        ...p,
        available: health.ok,
        status: health.ok ? "available" : "offline",
      };
    }
    const isRegistered = health.providers.includes(p.id);
    return {
      ...p,
      available: health.ok && isRegistered,
      status: !health.ok ? "offline" : isRegistered ? "available" : "unregistered",
    };
  });

  return NextResponse.json({
    serverOnline: health.ok,
    proxyEnabled: health.proxy,
    providers,
  });
}
