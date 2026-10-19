export interface LibraryEntry {
  id: string;
  anime_id: string; // the AniList id, stored as text (anime.external_id)
  status: string;
  progress: number;
  user_id: string;
}

/** Map of String(external_id) -> the user's library row for that anime. */
export function buildLibraryMap(entries?: LibraryEntry[]) {
  const map = new Map<string, LibraryEntry>();
  for (const entry of entries ?? []) map.set(String(entry.anime_id), entry);
  return map;
}