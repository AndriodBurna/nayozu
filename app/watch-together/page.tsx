import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryPageSkeleton } from "@/components/loading";
import { parseWatchRoomPayload } from "./actions";
import WatchTogetherClient, {
  type WatchRoomAnimeOption,
  type WatchRoomChatMessage,
  type WatchRoomItem,
  type WatchTogetherCurrentUser,
} from "./watch-together-client";

export const metadata: Metadata = {
  title: "Watch Together | Nayozu",
  description:
    "Create or join Watch Together rooms on Nayozu with live participant presence, room chat, and host-coordinated playback.",
};

interface RawProfile {
  username: string | null;
  display_name?: string | null;
  avatar_url: string | null;
}

interface RawCommentRow {
  id: string;
  user_id: string;
  anime_id: string;
  parent_comment_id: string | null;
  body: string;
  is_hidden: boolean;
  created_at: string;
  profiles: RawProfile | RawProfile[] | null;
}

interface RawAnimeRow {
  external_id: number;
  slug: string;
  title_romaji: string;
  title_english: string | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  episodes: number | null;
  trailer_id: string | null;
  trailer_site: string | null;
  official_video_id: string | null;
  official_video_kind: "video" | "playlist" | null;
  official_video_credit: string | null;
}

function normalizeProfile(raw: RawProfile | RawProfile[] | null, userId: string) {
  const p = Array.isArray(raw) ? raw[0] : raw;
  const fallback = `user_${userId.slice(0, 6)}`;
  return {
    username: p?.username || fallback,
    displayName: p?.display_name || p?.username || fallback,
    avatarUrl: p?.avatar_url ?? null,
  };
}

function buildShowcaseRooms(animeOptions: WatchRoomAnimeOption[]): WatchRoomItem[] {
  const presets = [
    {
      id: "showcase-shonen-night",
      roomTitle: "Shonen Action Première Watch",
      description:
        "Community showcase room — test live Realtime presence, episode switching, and the shared watch timer.",
      episodeNumber: 1,
      language: "sub" as const,
      status: "live" as const,
      hostUsername: "Kaito",
      maxParticipants: 10,
    },
    {
      id: "showcase-late-night-club",
      roomTitle: "Late Night Anime Club — Ep 1 Rewatch",
      description:
        "Open showcase room for coordinating episode watch-alongs with fellow fans.",
      episodeNumber: 1,
      language: "sub" as const,
      status: "live" as const,
      hostUsername: "LunaRin",
      maxParticipants: 12,
    },
    {
      id: "showcase-weekend-dub",
      roomTitle: "Weekend English Dub Lounge",
      description:
        "Relaxed intermission lobby before starting the next episode together.",
      episodeNumber: 2,
      language: "dub" as const,
      status: "intermission" as const,
      hostUsername: "Mochi",
      maxParticipants: 8,
    },
  ];

  const now = new Date().toISOString();
  const result: WatchRoomItem[] = [];

  for (let i = 0; i < presets.length; i++) {
    const anime = animeOptions[i];
    if (!anime) continue;
    const preset = presets[i];
    result.push({
      id: preset.id,
      isShowcase: true,
      roomTitle: preset.roomTitle,
      description: preset.description,
      animeExternalId: anime.externalId,
      animeSlug: anime.slug,
      animeTitle: anime.title,
      animeCover: anime.coverImage,
      episodeNumber: preset.episodeNumber,
      totalEpisodes: anime.episodes,
      language: preset.language,
      status: preset.status,
      privacy: "public",
      maxParticipants: preset.maxParticipants,
      timerSeconds: 0,
      isPlaying: false,
      timerUpdatedAt: now,
      createdAt: now,
      hostId: `showcase-host-${i}`,
      host: {
        username: preset.hostUsername,
        displayName: preset.hostUsername,
        avatarUrl: null,
      },
      chatMessages: [],
    });
  }

  return result;
}

export default async function WatchTogetherPage() {
  const supabase = await createClient();

  let loadError: string | null = null;
  let currentUser: WatchTogetherCurrentUser | null = null;

  try {
    const [roomRowsRes, animeRes, authRes] = await Promise.all([
      supabase
        .from("anime_comments")
        .select(
          `
          id,
          user_id,
          anime_id,
          parent_comment_id,
          body,
          is_hidden,
          created_at,
          profiles ( username, display_name, avatar_url )
        `
        )
        .eq("anime_id", "watch_room")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(100),

      supabase
        .from("anime")
        .select(
          "external_id, slug, title_romaji, title_english, cover_image_url, banner_image_url, episodes, trailer_id, trailer_site, official_video_id, official_video_kind, official_video_credit"
        )
        .eq("media_type", "anime")
        .neq("status", "NOT_YET_RELEASED")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(60),

      supabase.auth.getUser(),
    ]);

    if (roomRowsRes.error) {
      loadError = roomRowsRes.error.message;
    }

    const user = authRes.data?.user;
    if (user) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      const fallbackUsername =
        profileData?.username ||
        (user.user_metadata?.username as string | undefined) ||
        user.email?.split("@")[0] ||
        `user_${user.id.slice(0, 6)}`;

      currentUser = {
        id: user.id,
        username: fallbackUsername,
        avatarUrl: profileData?.avatar_url ?? null,
      };
    }

    const rawAnime = (animeRes.data ?? []) as RawAnimeRow[];
    const animeOptions: WatchRoomAnimeOption[] = rawAnime.map((a) => ({
      externalId: String(a.external_id),
      slug: a.slug,
      title: a.title_english || a.title_romaji,
      coverImage: a.cover_image_url ?? null,
      bannerImage: a.banner_image_url ?? null,
      episodes: a.episodes ? Number(a.episodes) : null,
      trailerId: a.trailer_id ?? null,
      trailerSite: a.trailer_site ?? null,
      officialVideoId: a.official_video_id ?? null,
      officialVideoKind: a.official_video_kind ?? null,
      officialVideoCredit: a.official_video_credit ?? null,
    }));

    const rawRows = (roomRowsRes.data ?? []) as unknown as RawCommentRow[];
    const chatByRoom = new Map<string, WatchRoomChatMessage[]>();
    const topLevelRoomRows: RawCommentRow[] = [];

    for (const row of rawRows) {
      if (row.parent_comment_id) {
        const author = normalizeProfile(row.profiles, row.user_id);
        const list = chatByRoom.get(row.parent_comment_id) ?? [];
        list.push({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          author: {
            username: author.username,
            avatarUrl: author.avatarUrl,
          },
        });
        chatByRoom.set(row.parent_comment_id, list);
      } else {
        topLevelRoomRows.push(row);
      }
    }

    const persistedRooms: WatchRoomItem[] = [];
    for (const row of topLevelRoomRows) {
      const parsed = await parseWatchRoomPayload(row.body);
      if (!parsed || parsed.status === "ended") continue;
      const host = normalizeProfile(row.profiles, row.user_id);
      const chatMessages = (chatByRoom.get(row.id) ?? []).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      persistedRooms.push({
        id: row.id,
        isShowcase: false,
        roomTitle: parsed.roomTitle,
        description: parsed.description,
        animeExternalId: parsed.animeExternalId,
        animeSlug: parsed.animeSlug,
        animeTitle: parsed.animeTitle,
        animeCover: parsed.animeCover,
        episodeNumber: parsed.episodeNumber,
        totalEpisodes: parsed.totalEpisodes,
        language: parsed.language,
        status: parsed.status,
        privacy: parsed.privacy,
        maxParticipants: parsed.maxParticipants,
        timerSeconds: parsed.timerSeconds,
        isPlaying: parsed.isPlaying,
        timerUpdatedAt: parsed.timerUpdatedAt,
        createdAt: row.created_at,
        hostId: row.user_id,
        host,
        chatMessages,
      });
    }

    const showcaseRooms = buildShowcaseRooms(animeOptions);
    const allRooms = [...persistedRooms, ...showcaseRooms];

    return (
      <Suspense fallback={<DiscoveryPageSkeleton />}>
        <WatchTogetherClient
          initialRooms={allRooms}
          animeOptions={animeOptions}
          currentUser={currentUser}
          loadError={loadError}
        />
      </Suspense>
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load Watch Together lobby";
    return (
      <Suspense fallback={<DiscoveryPageSkeleton />}>
        <WatchTogetherClient
          initialRooms={[]}
          animeOptions={[]}
          currentUser={null}
          loadError={message}
        />
      </Suspense>
    );
  }
}
