import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AnimeCarousel from "@/components/anime-carousel";
import CommentList from "@/components/comment-list";
import ErrorState from "@/components/error";
import { Badge } from "@/components/ui/badge";
import { AUTH_ENABLED } from "@/lib/features";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";
import { createClient } from "@/lib/supabase/server";

const WITH_GENRES = "*, anime_genres(genres(name))";

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

// cache(): generateMetadata and the page share one query per request.
const getAnime = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeAnime(data as unknown as AnimeRow) : null;
});

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const anime = await getAnime(slug);
    if (!anime) return { title: "Not found | Nayozu" };
    return {
      title: `${anime.title} | Nayozu`,
      description: anime.synopsis?.slice(0, 160) ?? undefined,
    };
  } catch {
    return { title: "Nayozu" };
  }
}

export default async function AnimeDetailPage({ params }: Props) {
  const { slug } = await params;

  let anime: Awaited<ReturnType<typeof getAnime>>;
  try {
    anime = await getAnime(slug);
  } catch (err) {
    const e = err as { message?: string; code?: string };
    console.error("Failed to load anime:", slug, e?.message, e?.code);
    return <ErrorState message="Failed to load anime details" />;
  }
  if (!anime) notFound();

  // "More to explore": most popular titles other than this one (non-fatal if it fails)
  const supabase = await createClient();
  const { data: moreData } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .neq("id", anime.id)
    .order("popularity", { ascending: false, nullsFirst: false })
    .order("id")
    .limit(6);
  const more = ((moreData ?? []) as unknown as AnimeRow[]).map(normalizeAnime);

  const facts: Array<[string, string | number | null | undefined]> = [
    ["English title", anime.titleEnglish],
    ["Format", anime.format],
    ["Episodes", anime.episodeCount],
    ["Status", anime.status ? pretty(anime.status) : null],
    ["Season", [anime.releaseSeason?.toLowerCase(), anime.releaseYear].filter(Boolean).join(" ")],
    ["Score", anime.averageScore ? `${anime.averageScore}/100` : null],
    ["Popularity", anime.popularity?.toLocaleString()],
  ];

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Link href="/anime" className="text-sm text-muted-foreground hover:underline">
          ← Back to Anime
        </Link>
      </div>

      {anime.bannerImage && (
        <div className="relative h-40 overflow-hidden rounded-xl border sm:h-56">
          <Image
            src={anime.bannerImage}
            alt=""
            fill
            priority
            sizes="(min-width: 1152px) 1100px, 100vw"
            className="object-cover"
          />
        </div>
      )}

      <div className="flex flex-col gap-8 sm:flex-row">
        {/* Poster */}
        <div className="w-44 shrink-0 sm:w-56">
          <div className="anime-card-poster overflow-hidden rounded-xl border">
            {anime.image ? (
              <Image
                src={anime.image}
                alt={anime.title}
                fill
                priority
                sizes="224px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No image
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 space-y-5">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{anime.title}</h1>
            <p className="text-sm text-muted-foreground">
              {[anime.releaseYear, anime.format, anime.episodeCount ? `${anime.episodeCount} episodes` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {anime.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {anime.genres.map((g) => (
                <Link key={g.name} href={`/anime?genre=${encodeURIComponent(g.name)}`}>
                  <Badge variant="secondary" className="font-normal hover:bg-secondary/70">
                    {g.name}
                  </Badge>
                </Link>
              ))}
            </div>
          )}

          {anime.synopsis && (
            <p className="max-w-3xl leading-relaxed text-muted-foreground">{anime.synopsis}</p>
          )}

          <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-3 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2">
            {facts
              .filter(([, value]) => value !== null && value !== undefined && value !== "")
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b pb-2 last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium capitalize">{value}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {/* Comments come back with the authentication work (see lib/features.ts) */}
      {AUTH_ENABLED && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Comments</h2>
          <CommentList animeId={String(anime.external_id)} />
        </section>
      )}

      {more.length > 0 && (
        <AnimeCarousel title="More to explore" anime={more} userId={null} />
      )}
    </div>
  );
}