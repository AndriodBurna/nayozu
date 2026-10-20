"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Star } from "lucide-react";

interface AnimeCardProps {
  externalId?: number;
  title: string;
  image: string | null;
  averageScore?: number | null;
  episodes?: number | null;
  slug: string;
  mediaType?: "anime" | "manga";
  subtitle?: string;
}

export default function AnimeCard({
  title,
  image,
  averageScore,
  episodes,
  slug,
  mediaType = "anime",
  subtitle,
}: AnimeCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // Normalize score to 10-point scale for consistency with screenshot (e.g. 9.1, 8.7)
  const scoreFormatted = averageScore
    ? averageScore > 10
      ? (averageScore / 10).toFixed(1)
      : averageScore.toFixed(1)
    : null;

  return (
    <Link
      href={`/${mediaType}/${slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-[#121624] border border-[#1b2238] transition-all duration-300 hover:-translate-y-1.5 hover:border-[#6d44f6]/60 hover:shadow-xl hover:shadow-[#6d44f6]/10"
    >
      {/* Poster Image */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#181d30]">
        {image && !imgFailed ? (
          <Image
            src={image}
            alt={title}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 16vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            No Poster
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#0e121d] via-transparent to-transparent opacity-75 group-hover:opacity-50 transition-opacity" />
      </div>

      {/* Title & Metadata */}
      <div className="p-3">
        <h3 className="truncate text-sm font-semibold text-white group-hover:text-[#a380ff] transition-colors">
          {title}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
          {scoreFormatted ? (
            <span className="flex items-center gap-1 font-semibold text-amber-400">
              <Star className="h-3 w-3 fill-amber-400 stroke-none" />
              {scoreFormatted}
            </span>
          ) : null}
          {episodes ? <span>• {episodes} Episodes</span> : null}
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
    </Link>
  );
}