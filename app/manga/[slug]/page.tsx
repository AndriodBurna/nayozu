import type { Metadata } from "next";
import MediaDetail, { generateMediaMetadata } from "@/components/media-detail";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return generateMediaMetadata(slug, "manga");
}

export default async function MangaDetailPage({ params }: Props) {
  const { slug } = await params;
  return <MediaDetail slug={slug} mediaType="manga" />;
}
