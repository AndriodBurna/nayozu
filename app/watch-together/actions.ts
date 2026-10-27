"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type WatchRoomStatus = "live" | "intermission" | "ended";
export type WatchRoomPrivacy = "public" | "private";

export interface WatchRoomPayload {
  version: 1;
  roomTitle: string;
  description: string | null;
  animeExternalId: string;
  animeSlug: string;
  animeTitle: string;
  animeCover: string | null;
  episodeNumber: number;
  totalEpisodes: number | null;
  language: "sub" | "dub";
  status: WatchRoomStatus;
  privacy: WatchRoomPrivacy;
  accessCodeHash?: string | null;
  maxParticipants: number;
  timerSeconds: number;
  isPlaying: boolean;
  timerUpdatedAt: string;
}

export interface CreateWatchRoomInput {
  roomTitle: string;
  description?: string;
  animeExternalId: string;
  episodeNumber?: number;
  language?: "sub" | "dub";
  privacy?: WatchRoomPrivacy;
  accessCode?: string;
  maxParticipants?: number;
}

export interface WatchRoomActionResult {
  success: boolean;
  roomId?: string;
  error?: string;
}

function hashAccessCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export async function parseWatchRoomPayload(rawBody: string): Promise<WatchRoomPayload | null> {
  try {
    const parsed = JSON.parse(rawBody) as Partial<WatchRoomPayload>;
    if (!parsed || parsed.version !== 1 || !parsed.roomTitle || !parsed.animeExternalId) {
      return null;
    }
    return {
      version: 1,
      roomTitle: String(parsed.roomTitle),
      description: parsed.description ? String(parsed.description) : null,
      animeExternalId: String(parsed.animeExternalId),
      animeSlug: String(parsed.animeSlug || ""),
      animeTitle: String(parsed.animeTitle || "Anime"),
      animeCover: parsed.animeCover ? String(parsed.animeCover) : null,
      episodeNumber: Math.max(Number(parsed.episodeNumber) || 1, 1),
      totalEpisodes: parsed.totalEpisodes ? Number(parsed.totalEpisodes) : null,
      language: parsed.language === "dub" ? "dub" : "sub",
      status:
        parsed.status === "intermission" || parsed.status === "ended"
          ? parsed.status
          : "live",
      privacy: parsed.privacy === "private" ? "private" : "public",
      accessCodeHash: parsed.accessCodeHash ?? null,
      maxParticipants: Math.min(Math.max(Number(parsed.maxParticipants) || 8, 2), 25),
      timerSeconds: Math.max(Number(parsed.timerSeconds) || 0, 0),
      isPlaying: Boolean(parsed.isPlaying),
      timerUpdatedAt: parsed.timerUpdatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function checkUserAllowed(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: restrictions } = await supabase
    .from("user_restrictions")
    .select("restriction_type, expires_at")
    .eq("user_id", userId);

  if (Array.isArray(restrictions) && restrictions.length > 0) {
    const nowMs = Date.now();
    const active = restrictions.find(
      (r) => !r.expires_at || new Date(r.expires_at).getTime() > nowMs
    );
    if (active) {
      return false;
    }
  }
  return true;
}

export async function createWatchRoomAction(
  input: CreateWatchRoomInput
): Promise<WatchRoomActionResult> {
  const cleanTitle = (input.roomTitle ?? "").trim();
  const cleanDesc = (input.description ?? "").trim();
  const cleanAnimeId = (input.animeExternalId ?? "").trim();

  if (!cleanTitle || cleanTitle.length < 3) {
    return {
      success: false,
      error: "Room title must be at least 3 characters long.",
    };
  }
  if (cleanTitle.length > 80) {
    return {
      success: false,
      error: "Room title cannot exceed 80 characters.",
    };
  }
  if (!cleanAnimeId) {
    return {
      success: false,
      error: "Please select an anime title to watch.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to create a Watch Together room.",
    };
  }

  const allowed = await checkUserAllowed(supabase, user.id);
  if (!allowed) {
    return {
      success: false,
      error: "Your account is currently restricted from creating rooms.",
    };
  }

  // Validate selected anime exists in database
  const { data: animeRow, error: animeErr } = await supabase
    .from("anime")
    .select(
      "external_id, slug, title_romaji, title_english, cover_image_url, episodes, status"
    )
    .eq("external_id", Number(cleanAnimeId))
    .eq("media_type", "anime")
    .maybeSingle();

  if (animeErr || !animeRow) {
    return {
      success: false,
      error: "Selected anime title could not be found in the catalog.",
    };
  }

  if (animeRow.status === "NOT_YET_RELEASED") {
    return {
      success: false,
      error: "Cannot start a watch room for an unreleased anime title.",
    };
  }

  const privacy: WatchRoomPrivacy = input.privacy === "private" ? "private" : "public";
  const rawCode = (input.accessCode ?? "").trim();
  if (privacy === "private" && rawCode.length < 4) {
    return {
      success: false,
      error: "Private rooms require an invite code of at least 4 characters.",
    };
  }

  // Ensure profile exists for the host
  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0] ||
    `user_${user.id.slice(0, 8)}`;

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      username: fallbackUsername,
      display_name:
        (user.user_metadata?.display_name as string | undefined) || fallbackUsername,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  const maxEp = animeRow.episodes ? Number(animeRow.episodes) : 2000;
  const epNumber = Math.min(Math.max(Number(input.episodeNumber) || 1, 1), maxEp);
  const maxParticipants = Math.min(Math.max(Number(input.maxParticipants) || 8, 2), 25);
  const now = new Date().toISOString();

  const payload: WatchRoomPayload = {
    version: 1,
    roomTitle: cleanTitle,
    description: cleanDesc ? cleanDesc.slice(0, 280) : null,
    animeExternalId: String(animeRow.external_id),
    animeSlug: animeRow.slug,
    animeTitle: animeRow.title_english || animeRow.title_romaji,
    animeCover: animeRow.cover_image_url ?? null,
    episodeNumber: epNumber,
    totalEpisodes: animeRow.episodes ? Number(animeRow.episodes) : null,
    language: input.language === "dub" ? "dub" : "sub",
    status: "live",
    privacy,
    accessCodeHash: privacy === "private" ? hashAccessCode(rawCode) : null,
    maxParticipants,
    timerSeconds: 0,
    isPlaying: false,
    timerUpdatedAt: now,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("anime_comments")
    .insert({
      user_id: user.id,
      anime_id: "watch_room",
      parent_comment_id: null,
      body: JSON.stringify(payload),
      is_spoiler: false,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return {
      success: false,
      error: insertError?.message || "Failed to create Watch Together room.",
    };
  }

  revalidatePath("/watch-together");
  return { success: true, roomId: inserted.id };
}

export async function verifyWatchRoomAccessAction(input: {
  roomId: string;
  accessCode?: string;
}): Promise<{ authorized: boolean; error?: string }> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId) {
    return { authorized: false, error: "Invalid room ID." };
  }

  // Built-in showcase rooms are public preview rooms
  if (cleanRoomId.startsWith("showcase-")) {
    return { authorized: true };
  }

  const supabase = await createClient();
  const [{ data: roomRow, error }, { data: authData }] = await Promise.all([
    supabase
      .from("anime_comments")
      .select("id, user_id, body, is_hidden")
      .eq("id", cleanRoomId)
      .eq("anime_id", "watch_room")
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (error || !roomRow || roomRow.is_hidden) {
    return { authorized: false, error: "This Watch Together room no longer exists." };
  }

  const payload = await parseWatchRoomPayload(roomRow.body);
  if (!payload) {
    return { authorized: false, error: "Invalid room configuration." };
  }

  if (payload.status === "ended") {
    return { authorized: false, error: "This Watch Together session has already ended." };
  }

  // Host always has access to their own room
  const userId = authData.user?.id;
  if (userId && userId === roomRow.user_id) {
    return { authorized: true };
  }

  if (payload.privacy === "private" && payload.accessCodeHash) {
    const provided = (input.accessCode ?? "").trim();
    if (!provided) {
      return {
        authorized: false,
        error: "This room is private. Please enter the room invite code.",
      };
    }
    if (hashAccessCode(provided) !== payload.accessCodeHash) {
      return {
        authorized: false,
        error: "Incorrect room invite code. Access denied.",
      };
    }
  }

  return { authorized: true };
}

export async function updateWatchRoomStateAction(input: {
  roomId: string;
  episodeNumber?: number;
  language?: "sub" | "dub";
  status?: WatchRoomStatus;
  timerSeconds?: number;
  isPlaying?: boolean;
}): Promise<WatchRoomActionResult> {
  const cleanRoomId = (input.roomId ?? "").trim();
  if (!cleanRoomId || cleanRoomId.startsWith("showcase-")) {
    return {
      success: false,
      error: "Showcase preview rooms cannot be modified on the server. Create your own room to host.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to manage a Watch Together room.",
    };
  }

  const { data: roomRow, error: fetchError } = await supabase
    .from("anime_comments")
    .select("id, user_id, body")
    .eq("id", cleanRoomId)
    .eq("anime_id", "watch_room")
    .maybeSingle();

  if (fetchError || !roomRow) {
    return { success: false, error: "Room not found." };
  }

  // Server-side host permission enforcement
  if (roomRow.user_id !== user.id) {
    return {
      success: false,
      error: "Permission denied: Only the room host can update playback state or room settings.",
    };
  }

  const existing = await parseWatchRoomPayload(roomRow.body);
  if (!existing) {
    return { success: false, error: "Corrupted room state." };
  }

  const maxEp = existing.totalEpisodes || 2000;
  const updated: WatchRoomPayload = {
    ...existing,
    episodeNumber:
      typeof input.episodeNumber === "number"
        ? Math.min(Math.max(input.episodeNumber, 1), maxEp)
        : existing.episodeNumber,
    language: input.language ? (input.language === "dub" ? "dub" : "sub") : existing.language,
    status: input.status ?? existing.status,
    timerSeconds:
      typeof input.timerSeconds === "number"
        ? Math.max(Math.floor(input.timerSeconds), 0)
        : existing.timerSeconds,
    isPlaying: typeof input.isPlaying === "boolean" ? input.isPlaying : existing.isPlaying,
    timerUpdatedAt: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("anime_comments")
    .update({
      body: JSON.stringify(updated),
      is_hidden: updated.status === "ended",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanRoomId)
    .eq("user_id", user.id);

  if (updateError) {
    return {
      success: false,
      error: updateError.message || "Failed to update room state.",
    };
  }

  revalidatePath("/watch-together");
  return { success: true, roomId: cleanRoomId };
}

export async function sendWatchRoomChatAction(input: {
  roomId: string;
  message: string;
  accessCode?: string;
}): Promise<{
  success: boolean;
  error?: string;
  chatMessage?: {
    id: string;
    body: string;
    createdAt: string;
    author: { username: string; avatarUrl: string | null };
  };
}> {
  const cleanRoomId = (input.roomId ?? "").trim();
  const cleanMessage = (input.message ?? "").trim();

  if (!cleanMessage) {
    return { success: false, error: "Chat message cannot be empty." };
  }
  if (cleanMessage.length > 500) {
    return { success: false, error: "Chat message cannot exceed 500 characters." };
  }
  if (cleanRoomId.startsWith("showcase-")) {
    return {
      success: false,
      error:
        "Persistent database chat is disabled in Showcase preview rooms. Create or join a user-hosted room to save messages.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "You must be signed in to send messages in room chat.",
    };
  }

  const allowed = await checkUserAllowed(supabase, user.id);
  if (!allowed) {
    return {
      success: false,
      error: "Your account is currently restricted from sending chat messages.",
    };
  }

  // Server-side room access validation before allowing chat post
  const access = await verifyWatchRoomAccessAction({
    roomId: cleanRoomId,
    accessCode: input.accessCode,
  });
  if (!access.authorized) {
    return {
      success: false,
      error: access.error || "You do not have permission to chat in this room.",
    };
  }

  const fallbackUsername =
    (user.user_metadata?.username as string | undefined) ||
    user.email?.split("@")[0] ||
    `user_${user.id.slice(0, 6)}`;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("anime_comments")
    .insert({
      user_id: user.id,
      anime_id: "watch_room",
      parent_comment_id: cleanRoomId,
      body: cleanMessage,
      is_spoiler: false,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    return {
      success: false,
      error: insertError?.message || "Failed to send chat message.",
    };
  }

  revalidatePath("/watch-together");
  return {
    success: true,
    chatMessage: {
      id: inserted.id,
      body: cleanMessage,
      createdAt: inserted.created_at,
      author: {
        username: profileRow?.username || fallbackUsername,
        avatarUrl: profileRow?.avatar_url ?? null,
      },
    },
  };
}
