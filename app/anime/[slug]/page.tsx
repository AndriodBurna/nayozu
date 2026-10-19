import type { Metadata } from "next";
import MediaDetail, { generateMediaMetadata } from "@/components/media-detail";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return generateMediaMetadata(slug, "anime");
}

export default async function AnimeDetailPage({ params }: Props) {
  const { slug } = await params;
  return <MediaDetail slug={slug} mediaType="anime" />;
}