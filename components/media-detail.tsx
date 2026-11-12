import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AnimeCarousel from "@/components/anime-carousel";
import CommentList from "@/components/comment-list";
import { MediaReviewsSection } from "@/components/media-reviews-section";
import ErrorState from "@/components/error";
import MediaPlayer from "@/components/media-player";
import MangaReader from "@/components/manga-reader";
import MediaLibraryControls from "@/components/media-library-controls";
import type { LibraryStatus } from "@/lib/actions/libraryActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AUTH_ENABLED, ENABLE_ANIMESDK } from "@/lib/features";
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
  if (data) return normalizeAnime(data as unknown as AnimeRow);

  // Fallback 1: If slug ends with -<external_id>, check public.anime by external_id
  const idMatch = slug.match(/-(\d+)$/);
  if (idMatch) {
    const extId = Number(idMatch[1]);
    const { data: byExtId } = await supabase
      .from("anime")
      .select(WITH_GENRES)
      .eq("external_id", extId)
      .eq("media_type", mediaType)
      .maybeSingle();
    if (byExtId) return normalizeAnime(byExtId as unknown as AnimeRow);

    // Fallback 2: Fetch live metadata from AniList GraphQL for newly airing calendar titles
    try {
      const query = `
        query ($id: Int, $type: MediaType) {
          Media(id: $id, type: $type, isAdult: false) {
            id
            title { romaji english }
            description
            coverImage { extraLarge large }
            bannerImage
            episodes
            chapters
            volumes
            status
            season
            seasonYear
            format
            countryOfOrigin
            averageScore
            popularity
            genres
            trailer { id site }
            externalLinks { site url type language }
          }
        }
      `;
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { id: extId, type: mediaType === "manga" ? "MANGA" : "ANIME" },
        }),
        next: { revalidate: 3600 },
      });
      if (res.ok) {
        const json = await res.json();
        const m = json?.data?.Media;
        if (m) {
          const row: AnimeRow = {
            id: `anilist-${m.id}`,
            external_id: Number(m.id),
            slug,
            title_romaji: m.title?.romaji || m.title?.english || "Unknown Title",
            title_english: m.title?.english ?? null,
            synopsis: m.description ?? null,
            cover_image_url: m.coverImage?.extraLarge || m.coverImage?.large || null,
            banner_image_url: m.bannerImage ?? null,
            episodes: m.episodes ?? null,
            chapters: m.chapters ?? null,
            volumes: m.volumes ?? null,
            status: m.status ?? null,
            season: m.season ?? null,
            season_year: m.seasonYear ?? null,
            format: m.format ?? null,
            country: m.countryOfOrigin ?? null,
            average_score: m.averageScore ?? null,
            popularity: m.popularity ?? null,
            media_type: mediaType,
            external_links: Array.isArray(m.externalLinks) ? m.externalLinks : null,
            trailer_site: m.trailer?.site ?? null,
            trailer_id: m.trailer?.id ?? null,
            anime_genres: Array.isArray(m.genres)
              ? m.genres.map((g: string) => ({ genres: { name: g } }))
              : [],
          };
          return normalizeAnime(row);
        }
      }
    } catch {
      // Fall through to null if AniList is unreachable
    }
  }

  return null;
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
    supabase.auth.getUser(),
  ]);

  const more = (((moreRes.data ?? []) as unknown as AnimeRow[])).map(normalizeAnime);

  const user = userRes.data.user;
  const userId = user?.id ?? null;
  let userProgress = 0;
  let userLibraryStatus: LibraryStatus | null = null;
  let userIsFavorite = false;

  if (user) {
    const candidateKeys = isManga
      ? [`manga:${item.external_id}`, String(item.external_id), `fav:manga:${item.external_id}`]
      : [String(item.external_id), `fav:anime:${item.external_id}`];

    const { data: libRows } = await supabase
      .from("user_anime_library")
      .select("anime_id, status, progress")
      .eq("user_id", user.id)
      .in("anime_id", candidateKeys);

    for (const r of libRows ?? []) {
      if (String(r.anime_id).startsWith("fav:")) {
        userIsFavorite = true;
      } else {
        userProgress = typeof r.progress === "number" ? r.progress : 0;
        userLibraryStatus = (r.status as LibraryStatus) || "planned";
      }
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
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Link href={parentHref} className="hover:text-foreground hover:underline transition-colors">
          ← Back to {parentName}
        </Link>
        {!isManga && (
          <>
            <span>·</span>
            {item.format === "MOVIE" ? (
              <Link href="/movies" className="hover:text-primary hover:underline transition-colors">
                Browse Movies
              </Link>
            ) : (
              <Link href="/series" className="hover:text-primary hover:underline transition-colors">
                Browse Series
              </Link>
            )}
            {item.status === "NOT_YET_RELEASED" && (
              <>
                <span>·</span>
                <Link href="/coming-soon" className="hover:text-primary hover:underline transition-colors">
                  Coming Soon
                </Link>
              </>
            )}
          </>
        )}
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
            <MediaLibraryControls
              externalId={item.external_id}
              mediaType={isManga ? "manga" : "anime"}
              userId={userId}
              initialStatus={userLibraryStatus}
              initialProgress={userProgress}
              initialFavorite={userIsFavorite}
            />
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
      {!isManga && item.status === "NOT_YET_RELEASED" ? (
        <section className="rounded-2xl border border-[#1e253d] bg-[#121625] p-6 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-primary text-primary-foreground">Upcoming Release</Badge>
            <span className="text-xs text-zinc-400">
              {[item.releaseSeason?.toLowerCase(), item.releaseYear].filter(Boolean).join(" ") ||
                "Release date TBA"}
            </span>
          </div>
          <h2 className="text-base font-semibold text-white">Not Yet Available to Stream</h2>
          <p className="text-sm text-zinc-400">
            This title has not been released yet. Check back once episodes or theatrical screenings become available.
          </p>
        </section>
      ) : (
        !isManga &&
        (videoEpisodes.length > 0 || ENABLE_ANIMESDK) && (
          <section className="space-y-4">
            <MediaPlayer
              animeId={String(item.external_id)}
              title={item.title}
              episodes={videoEpisodes}
              initialProgress={userProgress}
              userId={userId}
            />
          </section>
        )
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
          <MediaReviewsSection externalId={String(item.external_id)} mediaType={mediaType} mediaTitle={item.title} />
          <div className="rounded-3xl border border-white/10 bg-[#10131c] p-5 md:p-6">
            <CommentList animeId={String(item.external_id)} mediaType={mediaType} contextLabel={`General ${parentName} Comments`} />
          </div>
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
