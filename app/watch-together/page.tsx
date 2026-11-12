import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryPageSkeleton } from "@/components/loading";
import { fetchSharedWatchTogetherRooms } from "@/lib/watch-together/roomService";
import WatchTogetherClient, {
  type WatchRoomAnimeOption,
  type WatchRoomItem,
  type WatchTogetherCurrentUser,
} from "./watch-together-client";

export const metadata: Metadata = {
  title: "Watch Together | Nayozu",
  description:
    "Create or join Watch Together rooms on Nayozu with live participant presence, room chat, and host-coordinated playback.",
};

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

export default async function WatchTogetherPage() {
  let loadError: string | null = null;
  let currentUser: WatchTogetherCurrentUser | null = null;

  try {
    const supabase = await createClient();
    const authRes = await supabase.auth.getUser();
    const user = authRes.data?.user ?? null;

    const [sharedRoomsRes, animeRes, profileRes] = await Promise.all([
      fetchSharedWatchTogetherRooms(supabase, {
        currentUserId: user?.id ?? null,
      }).catch((err: unknown) => {
        loadError =
          err instanceof Error
            ? err.message
            : "Failed to load Watch Together rooms.";
        return {
          lobbyRooms: [],
          drawerRooms: [],
          blockedSet: new Set<string>(),
          hostActivityMap: new Map(),
        };
      }),

      supabase
        .from("anime")
        .select(
          "external_id, slug, title_romaji, title_english, cover_image_url, banner_image_url, episodes, trailer_id, trailer_site, official_video_id, official_video_kind, official_video_credit"
        )
        .eq("media_type", "anime")
        .neq("status", "NOT_YET_RELEASED")
        .order("popularity", { ascending: false, nullsFirst: false })
        .limit(60),

      user
        ? supabase
            .from("profiles")
            .select("username, display_name, avatar_url, profile_visibility")
            .eq("id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (user) {
      const profileData = profileRes.data;
      const fallbackUsername =
        profileData?.username ||
        (user.user_metadata?.username as string | undefined) ||
        user.email?.split("@")[0] ||
        `user_${user.id.slice(0, 6)}`;

      currentUser = {
        id: user.id,
        username: fallbackUsername,
        displayName:
          profileData?.display_name ||
          (user.user_metadata?.display_name as string | undefined) ||
          fallbackUsername,
        avatarUrl: profileData?.avatar_url ?? null,
        isPublicProfile: profileData?.profile_visibility === "public",
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

    const initialRooms: WatchRoomItem[] = sharedRoomsRes.lobbyRooms;
    const blockedUserIds = Array.from(sharedRoomsRes.blockedSet);

    return (
      <Suspense fallback={<DiscoveryPageSkeleton />}>
        <WatchTogetherClient
          initialRooms={initialRooms}
          animeOptions={animeOptions}
          currentUser={currentUser}
          blockedUserIds={blockedUserIds}
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
          blockedUserIds={[]}
          loadError={message}
        />
      </Suspense>
    );
  }
}
