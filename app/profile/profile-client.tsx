"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AtSign,
  Bookmark,
  BookOpen,
  Calendar,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Film,
  Glasses,
  Heart,
  History,
  Loader2,
  LogOut,
  Mail,
  Settings,
  Shield,
  Star,
  User as UserIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useShell } from "@/components/shell-context";
import {
  updateProfileSettingsAction,
  uploadAvatarAction,
} from "@/app/settings/actions";
import {
  deleteReviewAction,
  deleteDiscussionAction,
  deleteMediaCommentAction,
} from "@/lib/actions/communityActions";
import type { LibraryEntryItem, LibraryStatus } from "@/lib/actions/libraryActions";
import type { UserActivityHistoryItem } from "@/lib/services/userLibraryServer";

export interface ProfilePageData {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  profileVisibility?: "public" | "private";
  role: string;
  createdAt: string | null;
  updatedAt: string | null;
  initialTab?: string;
  animeWatchlist: LibraryEntryItem[];
  mangaReadingList: LibraryEntryItem[];
  favorites: LibraryEntryItem[];
  historyItems: UserActivityHistoryItem[];
  myReviews?: Array<{
    id: string;
    animeId: string;
    mediaTitle: string;
    mediaSlug: string | null;
    mediaType: "anime" | "manga";
    title: string | null;
    body: string;
    score: number | null;
    createdAt: string;
  }>;
  myDiscussions?: Array<{
    id: string;
    category: "discussion" | "question";
    title: string;
    body: string;
    mediaTitle: string | null;
    mediaSlug: string | null;
    mediaType: "anime" | "manga" | null;
    isLocked: boolean;
    createdAt: string;
  }>;
  myComments?: Array<{
    id: string;
    animeId: string;
    mediaTitle: string;
    mediaSlug: string | null;
    mediaType: "anime" | "manga";
    episodeNumber: number | null;
    chapterNumber: number | null;
    body: string;
    createdAt: string;
  }>;
}

const AVATAR_PRESETS = [
  {
    label: "Cyber Neon",
    url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Tokyo Night",
    url: "https://images.unsplash.com/photo-1563089145-599997674d42?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Astral Prism",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=240&auto=format&fit=crop&q=80",
  },
  {
    label: "Violet Horizon",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80",
  },
];

function formatCanonicalStatus(status: LibraryStatus): string {
  switch (status) {
    case "planned":
      return "Planning";
    case "watching":
      return "In Progress";
    case "completed":
      return "Completed";
    case "on_hold":
      return "On Hold";
    case "dropped":
      return "Dropped";
    default:
      return status;
  }
}

export default function ProfileClient({
  initialProfile,
}: {
  initialProfile: ProfilePageData;
}) {
  const router = useRouter();
  const { refreshUser, signOut } = useShell();
  const [isPending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [username, setUsername] = useState(initialProfile.username);
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatarUrl);
  const [bio, setBio] = useState(initialProfile.bio);

  const [savedProfile, setSavedProfile] = useState({
    username: initialProfile.username,
    displayName: initialProfile.displayName,
    avatarUrl: initialProfile.avatarUrl,
    bio: initialProfile.bio,
    updatedAt: initialProfile.updatedAt,
  });

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || uploadingAvatar) return;

    setError(null);
    setSuccessMsg(null);
    setUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.set("avatar", file);
      const res = await uploadAvatarAction(formData);
      if (!res.success || !res.avatarUrl) {
        setError(res.error || "Failed to upload avatar image.");
        return;
      }

      setAvatarUrl(res.avatarUrl);
      setSavedProfile((prev) => ({
        ...prev,
        avatarUrl: res.avatarUrl!,
        updatedAt: new Date().toISOString(),
      }));
      setSuccessMsg(res.message || "Avatar uploaded and saved!");
      await refreshUser();
      router.refresh();
    } finally {
      setUploadingAvatar(false);
    }
  };
  const validTabs = [
    "watchlist",
    "reading-list",
    "favorites",
    "history",
    "my-reviews",
    "my-discussions",
    "my-comments",
  ] as const;
  type ProfileTabKey = (typeof validTabs)[number];
  const resolvedInitialTab: ProfileTabKey = validTabs.includes(
    initialProfile.initialTab as ProfileTabKey
  )
    ? (initialProfile.initialTab as ProfileTabKey)
    : "watchlist";

  const [activeTab, setActiveTab] = useState<ProfileTabKey>(resolvedInitialTab);
  const myReviews = initialProfile.myReviews ?? [];
  const myDiscussions = initialProfile.myDiscussions ?? [];
  const myComments = initialProfile.myComments ?? [];

  const handleDeleteContribution = (
    kind: "review" | "discussion" | "comment",
    id: string
  ) => {
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const res =
        kind === "review"
          ? await deleteReviewAction({ reviewId: id })
          : kind === "discussion"
            ? await deleteDiscussionAction({ discussionId: id })
            : await deleteMediaCommentAction({ commentId: id });
      if (!res.success) {
        setError(res.error || `Failed to delete ${kind}.`);
        return;
      }
      setSuccessMsg(`Deleted your ${kind}.`);
      router.refresh();
    });
  };

  const totalEpisodesWatched = initialProfile.animeWatchlist.reduce(
    (sum, item) => sum + (item.progress || 0),
    0
  );
  const totalChaptersRead = initialProfile.mangaReadingList.reduce(
    (sum, item) => sum + (item.progress || 0),
    0
  );
  const completedCount = [
    ...initialProfile.animeWatchlist,
    ...initialProfile.mangaReadingList,
  ].filter((item) => item.status === "completed").length;

  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;

    setError(null);
    setSuccessMsg(null);

    startTransition(async () => {
      const res = await updateProfileSettingsAction({
        username,
        displayName,
        avatarUrl,
        bio,
      });

      if (!res.success) {
        setError(res.error || "Failed to update profile.");
        return;
      }

      if (res.profile) {
        setSavedProfile({
          username: res.profile.username,
          displayName: res.profile.displayName,
          avatarUrl: res.profile.avatarUrl,
          bio: res.profile.bio,
          updatedAt: res.profile.updatedAt,
        });
        setUsername(res.profile.username);
        setDisplayName(res.profile.displayName);
        setAvatarUrl(res.profile.avatarUrl);
        setBio(res.profile.bio);
      }

      setEditMode(false);
      setSuccessMsg(res.message || "Profile updated!");
      await refreshUser();
      router.refresh();
    });
  };

  const handleCancelEdit = () => {
    setUsername(savedProfile.username);
    setDisplayName(savedProfile.displayName);
    setAvatarUrl(savedProfile.avatarUrl);
    setBio(savedProfile.bio);
    setError(null);
    setEditMode(false);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const activeEntries =
    activeTab === "watchlist"
      ? initialProfile.animeWatchlist
      : activeTab === "reading-list"
        ? initialProfile.mangaReadingList
        : initialProfile.favorites;

  return (
    <div className="space-y-8 pb-12">
      {/* Profile Hero Card */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1e253d] bg-gradient-to-br from-[#13192b] via-[#101422] to-[#0b0e17] p-6 sm:p-8 shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Avatar */}
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-3xl border-2 border-primary/50 bg-[#171d30] flex items-center justify-center text-3xl font-extrabold text-white shadow-lg shadow-primary/20">
              {savedProfile.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={savedProfile.avatarUrl}
                  alt={savedProfile.displayName || savedProfile.username}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span>
                  {(savedProfile.displayName || savedProfile.username || "U")
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
            </div>

            {/* Identity Details */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {savedProfile.displayName || savedProfile.username}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Shield className="h-3 w-3" />
                  {initialProfile.role}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                <span className="font-semibold text-zinc-200">
                  @{savedProfile.username}
                </span>
                {initialProfile.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5 text-zinc-500" />
                    {initialProfile.email}
                  </span>
                )}
                {initialProfile.createdAt && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                    Joined{" "}
                    {new Date(initialProfile.createdAt).toLocaleDateString(
                      "en-US",
                      { month: "short", year: "numeric", timeZone: "UTC" }
                    )}
                  </span>
                )}
              </div>

              <p className="max-w-2xl text-xs sm:text-sm text-zinc-300 leading-relaxed pt-1">
                {savedProfile.bio ||
                  "No bio added yet. Click 'Edit Profile' to share your favorite anime, manga, and genres with the community."}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!editMode && (
              <Button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccessMsg(null);
                  setEditMode(true);
                }}
                className="h-10 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:brightness-110"
              >
                <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                Edit Profile
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className="h-10 rounded-xl border-[#232a42] bg-[#151a2a] px-3.5 text-xs font-semibold text-zinc-200 hover:bg-[#1c2338]"
            >
              <Link href="/settings">
                <Settings className="mr-1.5 h-3.5 w-3.5" />
                Settings
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={signingOut}
              onClick={handleSignOut}
              className="h-10 rounded-xl border-red-500/30 bg-red-500/10 px-3.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
            >
              {signingOut ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
              )}
              {signingOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>
      </section>

      {/* Status Banners */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-zinc-400 hover:text-white"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-zinc-400 hover:text-white"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Edit Profile Panel */}
      {editMode && (
        <section className="rounded-3xl border border-primary/40 bg-[#101422] p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <UserIcon className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-lg font-bold text-white">Edit Profile</h2>
                <p className="text-xs text-zinc-400">
                  Update your public @username, display name, avatar, and bio.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
              aria-label="Close profile editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-5" noValidate>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="profile-display-name"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Display Name
                </Label>
                <Input
                  id="profile-display-name"
                  name="displayName"
                  type="text"
                  required
                  maxLength={60}
                  disabled={isPending}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your display name"
                  className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] text-sm text-white"
                />
                <p className="text-[11px] text-zinc-500">1–60 characters.</p>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="profile-username"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Username (@handle)
                </Label>
                <div className="relative">
                  <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="profile-username"
                    name="username"
                    type="text"
                    required
                    minLength={3}
                    maxLength={30}
                    disabled={isPending}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] pl-10 text-sm text-white"
                  />
                </div>
                <p className="text-[11px] text-zinc-500">
                  3–30 characters: letters, numbers, underscores (_), or hyphens (-).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label
                  htmlFor="profile-avatar-url"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Avatar Image (Upload or URL)
                </Label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25 transition-colors">
                  {uploadingAvatar ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <span>Upload Image (JPEG, PNG, WebP, GIF · max 2 MB)</span>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={isPending || uploadingAvatar}
                    onChange={handleAvatarFileUpload}
                    className="sr-only"
                  />
                </label>
              </div>
              <Input
                id="profile-avatar-url"
                name="avatarUrl"
                type="url"
                maxLength={500}
                disabled={isPending || uploadingAvatar}
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.jpg"
                className="h-11 rounded-xl border-[#232a42] bg-[#151a2a] text-sm text-white"
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-zinc-400">Quick presets:</span>
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setAvatarUrl(preset.url)}
                    className="rounded-lg border border-[#232a42] bg-[#151a2a] px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-primary/50 hover:text-white transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl("")}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-red-300"
                  >
                    Clear Avatar
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="profile-bio"
                  className="text-xs font-semibold text-zinc-300"
                >
                  Bio
                </Label>
                <span className="text-[11px] text-zinc-500">
                  {bio.length} / 500
                </span>
              </div>
              <textarea
                id="profile-bio"
                name="bio"
                rows={3}
                maxLength={500}
                disabled={isPending}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell the community about your favorite anime and manga..."
                className="w-full rounded-xl border border-[#232a42] bg-[#151a2a] p-3 text-sm text-white placeholder:text-zinc-500 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={handleCancelEdit}
                className="rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                className="rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/25"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Saving Changes...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Personal Library Stats Grid */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Link
          href="/watchlist"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Watchlist
            </span>
            <Bookmark className="h-4 w-4 text-primary" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {initialProfile.animeWatchlist.length}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Anime titles</p>
        </Link>

        <Link
          href="/reading-list"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Reading List
            </span>
            <Glasses className="h-4 w-4 text-primary" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {initialProfile.mangaReadingList.length}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Manga series</p>
        </Link>

        <Link
          href="/favorites"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Favorites
            </span>
            <Heart className="h-4 w-4 text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {initialProfile.favorites.length}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Saved favorites</p>
        </Link>

        <Link
          href="/library"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Completed
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">{completedCount}</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Finished titles</p>
        </Link>

        <Link
          href="/history"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Episodes
            </span>
            <Film className="h-4 w-4 text-sky-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {totalEpisodesWatched}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Episodes watched</p>
        </Link>

        <Link
          href="/history"
          className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Chapters
            </span>
            <BookOpen className="h-4 w-4 text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {totalChaptersRead}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Chapters read</p>
        </Link>
      </section>

      {/* Personal Library Section */}
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#1b2238] pb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Personal Library</h2>
            <p className="text-xs text-zinc-400">
              Your private anime Watchlist, manga Reading List, Favorites, and activity History.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-200"
            >
              <Link href={`/u/${encodeURIComponent(savedProfile.username)}`}>
                View Public Profile ({initialProfile.profileVisibility === "private" ? "Private" : "Public"})
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-xl border-[#232a42] bg-[#151a2a] text-xs font-semibold text-zinc-200"
            >
              <Link href="/library">
                Open Full Library Manager
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Collection Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              {
                id: "watchlist",
                label: `Watchlist (${initialProfile.animeWatchlist.length})`,
                icon: Bookmark,
              },
              {
                id: "reading-list",
                label: `Reading List (${initialProfile.mangaReadingList.length})`,
                icon: Glasses,
              },
              {
                id: "favorites",
                label: `Favorites (${initialProfile.favorites.length})`,
                icon: Heart,
              },
              {
                id: "history",
                label: `History (${initialProfile.historyItems.length})`,
                icon: History,
              },
              {
                id: "my-reviews",
                label: `My Reviews (${myReviews.length})`,
                icon: Star,
              },
              {
                id: "my-discussions",
                label: `My Discussions (${myDiscussions.length})`,
                icon: BookOpen,
              },
              {
                id: "my-comments",
                label: `My Comments (${myComments.length})`,
                icon: Edit3,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "border border-[#1b2238] bg-[#121624] text-zinc-400 hover:border-primary/40 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Active Tab Content */}
        {activeTab === "my-reviews" ? (
          myReviews.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
              <Star className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">No Reviews Published Yet</h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Rate and review anime or manga titles on any detail page or in the Community Hub.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {myReviews.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {rev.mediaSlug ? (
                        <Link
                          href={`/${rev.mediaType}/${rev.mediaSlug}`}
                          className="rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary hover:underline"
                        >
                          {rev.mediaTitle}
                        </Link>
                      ) : (
                        <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                          {rev.mediaTitle}
                        </span>
                      )}
                      {rev.score !== null && (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-300">
                          <Star className="h-3 w-3 fill-amber-300" />
                          {rev.score} / 10
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400">
                        {new Date(rev.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDeleteContribution("review", rev.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                    >
                      Delete Review
                    </button>
                  </div>
                  {rev.title && (
                    <h4 className="text-sm font-bold text-white">{rev.title}</h4>
                  )}
                  <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
                    {rev.body}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : activeTab === "my-discussions" ? (
          myDiscussions.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
              <BookOpen className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">No Discussions Started Yet</h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Start a discussion or ask a question in the Community Hub.
              </p>
              <Button asChild size="sm" className="bg-primary text-primary-foreground">
                <Link href="/community">Open Community Hub</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {myDiscussions.map((disc) => (
                <div
                  key={disc.id}
                  className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold uppercase text-primary">
                        {disc.category}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {new Date(disc.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        handleDeleteContribution("discussion", disc.id)
                      }
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                    >
                      Delete Discussion
                    </button>
                  </div>
                  <h4 className="text-sm font-bold text-white">{disc.title}</h4>
                  <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
                    {disc.body}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : activeTab === "my-comments" ? (
          myComments.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
              <Edit3 className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">No Comments Posted Yet</h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Comments you post on anime episodes, manga chapters, and detail pages will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {myComments.map((com) => (
                <div
                  key={com.id}
                  className="rounded-2xl border border-[#1c233a] bg-[#121624] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {com.mediaSlug ? (
                        <Link
                          href={`/${com.mediaType}/${com.mediaSlug}`}
                          className="rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary hover:underline"
                        >
                          {com.mediaTitle}
                        </Link>
                      ) : (
                        <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                          {com.mediaTitle}
                        </span>
                      )}
                      {com.episodeNumber && (
                        <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-300">
                          Episode {com.episodeNumber}
                        </span>
                      )}
                      {com.chapterNumber !== null && (
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                          Chapter {com.chapterNumber}
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400">
                        {new Date(com.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDeleteContribution("comment", com.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                    >
                      Delete Comment
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
                    {com.body}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : activeTab === "history" ? (
          initialProfile.historyItems.length === 0 ? (
            <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
              <History className="mx-auto h-8 w-8 text-zinc-500" />
              <h3 className="text-sm font-bold text-white">
                No Viewing or Reading Activity Yet
              </h3>
              <p className="max-w-md mx-auto text-xs text-zinc-400">
                Watch episodes, read chapters, or update your library progress to build your activity timeline.
              </p>
              <div className="flex justify-center gap-2.5 pt-1">
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/anime">Browse Anime</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/manga">Browse Manga</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {initialProfile.historyItems.slice(0, 8).map((item) => {
                const detailHref = `/${item.mediaType}/${item.slug}`;
                const unitLabel =
                  item.mediaType === "manga" ? "Chapter" : "Episode";
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-[#1c233a] bg-[#121624] p-3.5"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Link
                        href={detailHref}
                        className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#181d30]"
                      >
                        {item.coverImage ? (
                          <Image
                            src={item.coverImage}
                            alt={item.title}
                            fill
                            sizes="40px"
                            className="object-cover"
                          />
                        ) : null}
                      </Link>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {item.mediaType}
                          </Badge>
                          {item.status && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              {formatCanonicalStatus(item.status)} · {unitLabel}{" "}
                              {item.progress ?? 0}
                            </span>
                          )}
                        </div>
                        <Link
                          href={detailHref}
                          className="block truncate text-sm font-bold text-white hover:text-primary"
                        >
                          {item.title}
                        </Link>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs shrink-0">
                      <Link href={detailHref}>Resume</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          )
        ) : activeEntries.length === 0 ? (
          <div className="rounded-2xl border border-[#1b2238] bg-[#121624]/60 py-12 px-4 text-center space-y-3">
            <Bookmark className="mx-auto h-8 w-8 text-zinc-500" />
            <h3 className="text-sm font-bold text-white">
              {activeTab === "watchlist"
                ? "Your Watchlist is Empty"
                : activeTab === "reading-list"
                  ? "Your Reading List is Empty"
                  : "No Favorites Saved Yet"}
            </h3>
            <p className="max-w-md mx-auto text-xs text-zinc-400">
              {activeTab === "watchlist"
                ? "Add anime titles you plan to watch or are currently watching."
                : activeTab === "reading-list"
                  ? "Add manga series you plan to read or are currently reading."
                  : "Mark your favorite anime and manga titles to feature them here."}
            </p>
            <div className="flex justify-center gap-2.5 pt-1">
              <Button asChild size="sm" className="bg-primary text-primary-foreground">
                <Link href={`/${activeTab}`}>
                  Manage{" "}
                  {activeTab === "watchlist"
                    ? "Watchlist"
                    : activeTab === "reading-list"
                      ? "Reading List"
                      : "Favorites"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={activeTab === "reading-list" ? "/manga" : "/anime"}>
                  Browse Catalog
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeEntries.slice(0, 6).map((entry) => {
              const detailHref = `/${entry.mediaType}/${entry.media.slug}`;
              const unitName = entry.mediaType === "manga" ? "Ch" : "Ep";
              const score =
                entry.media.averageScore && entry.media.averageScore > 0
                  ? (entry.media.averageScore / 10).toFixed(1)
                  : null;

              return (
                <div
                  key={entry.id}
                  className="flex gap-3.5 rounded-2xl border border-[#1c233a] bg-[#121624] p-3.5 hover:border-primary/40 transition-colors"
                >
                  <Link
                    href={detailHref}
                    className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#181d30]"
                  >
                    {entry.media.coverImage ? (
                      <Image
                        src={entry.media.coverImage}
                        alt={entry.media.title}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : null}
                  </Link>
                  <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="rounded bg-primary/15 border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {formatCanonicalStatus(entry.status)}
                        </span>
                        {score && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-400">
                            <Star className="h-3 w-3 fill-amber-400 stroke-none" />
                            {score}
                          </span>
                        )}
                      </div>
                      <Link
                        href={detailHref}
                        className="line-clamp-1 text-sm font-bold text-white hover:text-primary transition-colors"
                      >
                        {entry.media.title}
                      </Link>
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-400 pt-2">
                      <span>
                        {unitName} <strong className="text-zinc-200">{entry.progress}</strong>
                        {entry.media.totalUnits ? ` / ${entry.media.totalUnits}` : ""}
                      </span>
                      <Link
                        href={`/${activeTab}`}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        Update →
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
