import Link from "next/link";
import Image from "next/image";
import {
  Play,
  Plus,
  Flame,
  BookOpen,
  Clock,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AnimeCard from "@/components/anime-card";
import Empty from "@/components/empty";
import ErrorState from "@/components/error";
import { createClient } from "@/lib/supabase/server";
import { normalizeAnime, type AnimeRow } from "@/lib/services/normalizeAnime";

const WITH_GENRES = "*, anime_genres(genres(name))";
const toList = (data: unknown) => ((data ?? []) as AnimeRow[]).map(normalizeAnime);

export default async function Home() {
  const supabase = await createClient();

  try {
    const [popularAnimeRes, popularMangaRes, latestRes] = await Promise.all([
      // Trending Anime
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", "anime")
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(6),
      // Popular Manga
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .eq("media_type", "manga")
        .order("popularity", { ascending: false, nullsFirst: false })
        .order("id")
        .limit(6),
      // Latest Releases / Episodes
      supabase
        .from("anime")
        .select(WITH_GENRES)
        .order("id", { ascending: false })
        .limit(5),
    ]);

    const trendingAnime = toList(popularAnimeRes.data);
    const popularManga = toList(popularMangaRes.data);
    const latestReleases = toList(latestRes.data);

    if (trendingAnime.length === 0 && latestReleases.length === 0) {
      return <Empty />;
    }

    // Selected hero anime: uses first trending anime item or fallback
    const hero = trendingAnime[0] || {
      title: "Demon Slayer: Kimetsu no Yaiba",
      synopsis:
        "A boy's journey to avenge his family and become the strongest Demon Slayer.",
      slug: "demon-slayer-kimetsu-no-yaiba",
      genres: ["Action", "Fantasy", "Adventure"],
      image:
        "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&auto=format&fit=crop&q=80",
    };

    return (
      <div className="flex flex-col gap-9 pb-12">
        {/* 1. HERO SHOWCASE */}
        <section className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-[#121625] min-h-[380px] flex items-end p-6 md:p-10">
          <div
            className="absolute inset-0 bg-cover bg-center brightness-75 transition-all duration-700"
            style={{
              backgroundImage: `url(${
                hero.image ||
                "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&auto=format&fit=crop&q=80"
              })`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0e17] via-[#0b0e17]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0e17] via-transparent to-transparent" />

          {/* Hero Content */}
          <div className="relative z-10 max-w-xl space-y-4">
            <span className="inline-block rounded-md bg-[#6d44f6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
              Trending
            </span>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
              {hero.title}
            </h1>
            <p className="line-clamp-2 text-sm text-zinc-300 md:text-base leading-relaxed">
              {hero.synopsis ||
                "Immerse yourself into this story with a passionate anime community."}
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
  {hero.genres?.slice(0, 3).map((g: any, index: number) => {
    const genreName = typeof g === "string" ? g : g?.name ?? "";
    if (!genreName) return null;
    return (
      <span
        key={`${genreName}-${index}`}
        className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-zinc-300 backdrop-blur-md"
      >
        {genreName}
      </span>
    );
  })}
</div>

            <div className="flex flex-wrap items-center gap-3 pt-3">
              <Button
                asChild
                className="h-11 rounded-xl bg-[#6d44f6] px-6 font-semibold text-white shadow-lg shadow-[#6d44f6]/30 hover:bg-[#5b32e6]"
              >
                <Link href={`/anime/${hero.slug}`}>
                  <Play className="mr-2 h-4 w-4 fill-white" /> Watch Now
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-xl border-white/20 bg-white/5 px-5 font-semibold text-white backdrop-blur-md hover:bg-white/10"
              >
                <Link href={`/anime/${hero.slug}`}>
                  <Plus className="mr-2 h-4 w-4" /> Add to Watchlist
                </Link>
              </Button>
            </div>
          </div>

          {/* Slider Controls */}
          <div className="absolute bottom-6 right-6 z-10 hidden md:flex items-center gap-2">
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md hover:bg-white/20 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md hover:bg-white/20 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* 2. TRENDING ANIME */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <h2 className="text-xl font-bold text-white">Trending Anime</h2>
            </div>
            <Link
              href="/anime?filter=trending"
              className="flex items-center text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              See All <ChevronRight className="h-4 w-4 ml-0.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {trendingAnime.map((item) => (
              <AnimeCard
                key={item.id}
                externalId={item.externalId}
                title={item.title}
                image={item.image}
                averageScore={item.averageScore}
                episodes={item.episodes}
                slug={item.slug}
                mediaType="anime"
              />
            ))}
          </div>
        </section>

        {/* 3. POPULAR MANGA & LATEST RELEASES */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Popular Manga (Left - 7 cols) */}
          <section className="space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-[#6d44f6]" />
                <h2 className="text-xl font-bold text-white">Popular Manga</h2>
              </div>
              <Link
                href="/manga"
                className="flex items-center text-xs font-semibold text-zinc-400 hover:text-white"
              >
                See All <ChevronRight className="h-4 w-4 ml-0.5" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3">
              {popularManga.map((manga) => (
                <AnimeCard
                  key={manga.id}
                  externalId={manga.externalId}
                  title={manga.title}
                  image={manga.image}
                  slug={manga.slug}
                  mediaType="manga"
                  subtitle={`${manga.popularity || "826K"} followers`}
                />
              ))}
            </div>
          </section>

          {/* Latest Releases (Right - 5 cols) */}
          <section className="space-y-4 lg:col-span-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-sky-400" />
                <h2 className="text-xl font-bold text-white">Latest Releases</h2>
              </div>
              <Link
                href="/anime?sort=latest"
                className="flex items-center text-xs font-semibold text-zinc-400 hover:text-white"
              >
                See All <ChevronRight className="h-4 w-4 ml-0.5" />
              </Link>
            </div>

            <div className="flex flex-col gap-2.5">
              {latestReleases.map((rel, idx) => (
                <Link
                  key={rel.id || idx}
                  href={`/anime/${rel.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-[#1a2034] bg-[#121625] p-2 hover:bg-[#181d30] transition-colors"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                    {rel.image && (
                      <Image
                        src={rel.image}
                        alt={rel.title}
                        fill
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="truncate text-sm font-semibold text-white">
                      {rel.title}
                    </h4>
                    <p className="text-xs text-zinc-400">
                      Episode {rel.episodes || 12} · 2h ago
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* 4. JOIN COMMUNITY BANNER */}
        <section className="relative overflow-hidden rounded-2xl border border-[#20273d] bg-gradient-to-r from-[#171a2b] via-[#211b36] to-[#121526] p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center md:text-left">
            <h3 className="text-lg font-bold text-white">Join the Community</h3>
            <p className="text-xs text-zinc-400">
              Discuss. Share. Make friends. Keep track of what you watch.
            </p>
          </div>
          <Button
            asChild
            className="rounded-xl bg-[#6d44f6] px-6 text-sm font-semibold text-white hover:bg-[#5b32e6] shadow-lg shadow-[#6d44f6]/30"
          >
            <Link href="/auth/sign-up">Create Account</Link>
          </Button>
        </section>
      </div>
    );
  } catch (err) {
    const e = err as { message?: string };
    console.error("Failed to load home page data:", e?.message);
    return <ErrorState message="Failed to load data" />;
  }
}