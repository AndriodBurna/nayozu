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
  format?: string | null;
  year?: number | null;
  season?: string | null;
  status?: string | null;
  genres?: string[];
  synopsis?: string | null;
  showExtendedMeta?: boolean;
}

const formatLabel = (fmt?: string | null) => {
  if (!fmt) return null;
  if (fmt === "TV_SHORT") return "TV Short";
  if (fmt === "MOVIE") return "Movie";
  if (fmt === "SPECIAL") return "Special";
  return fmt;
};

export default function AnimeCard({
  title,
  image,
  averageScore,
  episodes,
  slug,
  mediaType = "anime",
  subtitle,
  format,
  year,
  season,
  status,
  genres,
  synopsis,
  showExtendedMeta = false,
}: AnimeCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const scoreFormatted =
    typeof averageScore === "number" && averageScore > 0
      ? averageScore > 10
        ? (averageScore / 10).toFixed(1)
        : averageScore.toFixed(1)
      : null;

  const isUpcoming = status === "NOT_YET_RELEASED";
  const badgeText = formatLabel(format);
  const releaseWindow = isUpcoming
    ? [season ? season.charAt(0) + season.slice(1).toLowerCase() : null, year]
        .filter(Boolean)
        .join(" ") || "TBA"
    : year
      ? String(year)
      : null;

  return (
    <Link
      href={`/${mediaType}/${slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-[#121624] border border-[#1b2238] transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/60 hover:shadow-xl hover:shadow-primary/20"
    >
      {/* 2:3 Aspect Ratio Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#181d30]">
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
            No Image
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e121d] via-transparent to-transparent opacity-60" />

        {/* Format / Upcoming badges when available */}
        {(badgeText || isUpcoming) && (
          <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1.5 pointer-events-none">
            {badgeText ? (
              <span className="rounded-md bg-black/75 border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 backdrop-blur-md">
                {badgeText}
              </span>
            ) : (
              <span />
            )}
            {isUpcoming && (
              <span className="rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow-sm">
                Upcoming
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card Details */}
      <div className="flex flex-col gap-1.5 p-3">
        {/* Title dynamically adopts the user's selected accent on hover */}
        <h3 className="truncate text-xs md:text-sm font-semibold text-white group-hover:text-primary transition-colors">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] md:text-xs text-zinc-400">
          {scoreFormatted ? (
            <span className="flex items-center gap-1 font-semibold text-amber-400">
              <Star className="h-3 w-3 fill-amber-400 stroke-none" />
              {scoreFormatted}
            </span>
          ) : isUpcoming ? (
            <span className="font-medium text-primary">{releaseWindow}</span>
          ) : !subtitle ? (
            <span className="text-zinc-500">Unrated</span>
          ) : null}
          {!isUpcoming && releaseWindow ? <span>• {releaseWindow}</span> : null}
          {format === "MOVIE" ? (
            !releaseWindow ? <span>• Movie</span> : null
          ) : episodes ? (
            <span>• {episodes} eps</span>
          ) : null}
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {showExtendedMeta && genres && genres.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {genres.slice(0, 2).map((genreName) => (
              <span
                key={genreName}
                className="rounded bg-[#1a2035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
              >
                {genreName}
              </span>
            ))}
          </div>
        )}
        {showExtendedMeta && synopsis && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-400 pt-0.5">
            {synopsis}
          </p>
        )}
      </div>
    </Link>
  );
}
