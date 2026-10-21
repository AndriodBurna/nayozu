import { Metadata } from "next";
import { notFound } from "next/navigation";
import { ENABLE_ANIMESDK } from "@/lib/features";
import StreamTesterClient from "./stream-tester-client";

export const metadata: Metadata = {
  title: "AnimeSDK Stream Tester — NAYOZU",
  description: "Developer testing workbench for experimental anime playback providers.",
};

export default function TestStreamPage() {
  if (!ENABLE_ANIMESDK) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <StreamTesterClient />
    </div>
  );
}
