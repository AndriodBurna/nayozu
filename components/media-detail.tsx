import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AnimeCarousel from "@/components/anime-carousel";
import CommentList from "@/components/comment-list";
import ErrorState from "@/components/error";
import MediaPlayer from "@/components/media-player";
import MangaReader from "@/components/manga-reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AUTH_ENABLED } from "@/lib/features";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";
import { createClient } from "@/lib/supabase/server";
import type { MediaType } from "@/lib/services/animeService";
import {
  classifyExternalLink,
  deduplicateLinksBySite,
  resolveAnimeEpisodes,
  resolveMangaChapters,
} from "@/lib/providers/mediaProviderAdapter";

const WITH_GENRES = "*, anime_genres(genres(name))";

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

// cache(): generateMetadata and the page share one query per request.
export const getMediaItem = cache(async (slug: string, mediaType: MediaType = "anime") => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anime")
    .select(WITH_GENRES)
    .eq("slug", slug)
    .eq("media_type", mediaType)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeAnime(data as unknown as AnimeRow) : null;
});

export async function generateMediaMetadata(
  slug: string,
  mediaType: MediaType = "anime"
): Promise<Metadata> {
  try {
    const item = await getMediaItem(slug, mediaType);
    if (!item) return { title: "Not found | Nayozu" };
    return {
      title: `${item.title} | Nayozu`,
      description: item.synopsis?.slice(0, 160) ?? undefined,
    };
  } catch {
    return { title: "Nayozu" };
  }
}

interface MediaDetailProps {
  slug: string;
  mediaType?: MediaType;
}

export default async function MediaDetail({ slug, mediaType = "anime" }: MediaDetailProps) {
  let item: Awaited<ReturnType<typeof getMediaItem>>;
  try {
    item = await getMediaItem(slug, mediaType);
  } catch (err) {
    const e = err as { message?: string; code?: string };
    console.error(`Failed to load ${mediaType}:`, slug, e?.message, e?.code);
    return <ErrorState message={`Failed to load ${mediaType} details`} />;
  }
  if (!item) notFound();

  const isManga = mediaType === "manga";
  const parentName = isManga ? "Manga" : "Anime";
  const parentHref = isManga ? "/manga" : "/anime";

  // "More to explore": most popular titles other than this one
  const supabase = await createClient();
  const [moreRes, userRes] = await Promise.all([
    supabase
      .from("anime")
      .select(WITH_GENRES)
      .eq("media_type", mediaType)
      .neq("id", item.id)
      .order("popularity", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(6),
    AUTH_ENABLED
      ? supabase.auth.getUser()
      : Promise.resolve({ data: { user: null } }),
  ]);

  const more = (((moreRes.data ?? []) as unknown as AnimeRow[])).map(normalizeAnime);

  const user = userRes.data.user;
  const userId = user?.id ?? null;
  let userProgress = 0;
  if (user) {
    const { data: libRow } = await supabase
      .from("user_anime_library")
      .select("progress")
      .eq("user_id", user.id)
      .eq("anime_id", String(item.external_id))
      .maybeSingle();
    if (libRow && typeof libRow.progress === "number") {
      userProgress = libRow.progress;
    }
  }

  // Resolve in-site playback episodes or manga reading chapters
  const videoEpisodes = !isManga
    ? resolveAnimeEpisodes({
        id: item.id,
        title: item.title,
        officialVideoId: item.officialVideoId,
        officialVideoKind: item.officialVideoKind,
        officialVideoCredit: item.officialVideoCredit,
        episodeCount: item.episodeCount,
        coverImage: item.coverImage,
      })
    : [];

  const mangaChapters = isManga
    ? resolveMangaChapters({
        id: item.id,
        title: item.title,
        chapterCount: item.chapterCount,
        externalLinks: item.externalLinks,
      })
    : [];

  const facts: Array<[string, string | number | null | undefined]> = isManga
    ? [
        ["English title", item.titleEnglish],
        ["Format", item.format],
        ["Chapters", item.chapterCount],
        ["Volumes", item.volumeCount],
        ["Status", item.status ? pretty(item.status) : null],
        ["Country", item.country],
        ["Start Year", item.releaseYear],
        ["Score", item.averageScore ? `${item.averageScore}/100` : null],
        ["Popularity", item.popularity?.toLocaleString()],
      ]
    : [
        ["English title", item.titleEnglish],
        ["Format", item.format],
        ["Episodes", item.episodeCount],
        ["Status", item.status ? pretty(item.status) : null],
        ["Season", [item.releaseSeason?.toLowerCase(), item.releaseYear].filter(Boolean).join(" ")],
        ["Score", item.averageScore ? `${item.averageScore}/100` : null],
        ["Popularity", item.popularity?.toLocaleString()],
      ];

  const metaSubtitle = isManga
    ? [
        item.releaseYear,
        item.format,
        item.chapterCount ? `${item.chapterCount} chapters` : null,
        item.volumeCount ? `${item.volumeCount} volumes` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : [
        item.releaseYear,
        item.format,
        item.episodeCount ? `${item.episodeCount} episodes` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  // Classify and de-duplicate external links (one entry per site, prefer English or no-language)
  const rawLinks = item.externalLinks || [];
  const rawStreaming: typeof rawLinks = [];
  const rawInfo: typeof rawLinks = [];
  const rawSocial: typeof rawLinks = [];

  for (const l of rawLinks) {
    const cat = classifyExternalLink(l);
    if (cat === "streaming") rawStreaming.push(l);
    else if (cat === "social") rawSocial.push(l);
    else rawInfo.push(l);
  }

  const streamingLinks = deduplicateLinksBySite(rawStreaming);
  const infoLinks = deduplicateLinksBySite(rawInfo);
  const socialLinks = deduplicateLinksBySite(rawSocial);

  const hasTrailer =
    item.trailerSite?.toLowerCase() === "youtube" && Boolean(item.trailerId);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Link href={parentHref} className="text-sm text-muted-foreground hover:underline">
          ← Back to {parentName}
        </Link>
      </div>

      {item.bannerImage && (
        <div className="relative h-40 overflow-hidden rounded-xl border sm:h-56">
          <Image
            src={item.bannerImage}
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
            {item.image ? (
              <Image
                src={item.image}
                alt={item.title}
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
            <h1 className="text-3xl font-bold">{item.title}</h1>
            <p className="text-sm text-muted-foreground">{metaSubtitle}</p>
          </div>

          {item.genres.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.genres.map((g) => (
                <Link key={g.name} href={`/${mediaType}?genre=${encodeURIComponent(g.name)}`}>
                  <Badge variant="secondary" className="font-normal hover:bg-secondary/70">
                    {g.name}
                  </Badge>
                </Link>
              ))}
            </div>
          )}

          {item.synopsis && (
            <p className="max-w-3xl leading-relaxed text-muted-foreground">{item.synopsis}</p>
          )}

          <dl className="grid max-w-3xl grid-cols-1 gap-x-8 gap-y-3 rounded-xl border bg-card p-5 text-sm sm:grid-cols-2">
            {facts
              .filter(([, value]) => value !== null && value !== undefined && value !== "")
              .map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-b pb-2 last:border-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-0"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium capitalize">{value}</dd>
                </div>
              ))}
          </dl>

          {/* STREAMING links: Where to watch/read (one entry per site, hide if empty) */}
          {streamingLinks.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-semibold text-foreground">
                {isManga ? "Where to read" : "Where to watch"}
              </h3>
              <div className="flex flex-wrap gap-2">
                {streamingLinks.map((link) => (
                  <a
                    key={link.site}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    {link.site}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* INFO links: Official links (one entry per site, hide if empty) */}
          {(hasTrailer || infoLinks.length > 0) && (
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-semibold text-foreground">Official links</h3>
              <div className="flex flex-wrap items-center gap-2">
                {hasTrailer && (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.trailerId!)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5"
                    >
                      ▶ Watch Trailer
                    </a>
                  </Button>
                )}
                {infoLinks.map((link) => (
                  <a
                    key={link.site}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    {link.site}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* SOCIAL links: once per site as small links at the bottom (hide if empty) */}
          {socialLinks.length > 0 && (
            <div className="pt-2 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">Social:</span>
              {socialLinks.map((link) => (
                <a
                  key={link.site}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground hover:underline transition-colors"
                >
                  {link.site}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* In-Site Experience: Video Player for Anime, Chapter Reader for Manga */}
      {!isManga && videoEpisodes.length > 0 && (
        <section className="space-y-4">
          <MediaPlayer
            animeId={String(item.external_id)}
            title={item.title}
            episodes={videoEpisodes}
            initialProgress={userProgress}
            userId={userId}
          />
        </section>
      )}

      {isManga && mangaChapters.length > 0 && (
        <section className="space-y-4">
          <MangaReader
            animeId={String(item.external_id)}
            title={item.title}
            chapters={mangaChapters}
            initialProgress={userProgress}
            userId={userId}
          />
        </section>
      )}

      {/* Comments */}
      {AUTH_ENABLED && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Comments</h2>
          <CommentList animeId={String(item.external_id)} />
        </section>
      )}

      {more.length > 0 && (
        <AnimeCarousel
          title={`More ${parentName.toLowerCase()} to explore`}
          anime={more}
          userId={null}
        />
      )}
    </div>
  );
}
