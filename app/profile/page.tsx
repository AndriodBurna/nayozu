"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  // Fetch profile
  async function fetchProfile() {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      setError("Failed to load profile");
    } else {
      setProfile(data);
      setDisplayName(data.display_name || "");
      setBio(data.bio || "");
    }
    setLoading(false);
  }

  // Update profile
  async function updateProfile() {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        bio: bio,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) {
      setError("Failed to update profile");
    } else {
      setProfile({
        ...profile,
        display_name: displayName,
        bio: bio,
        updated_at: new Date().toISOString(),
      });
      setEditMode(false);
    }
    setLoading(false);
  }

  // Fetch profile on mount
  useEffect(() => {
    fetchProfile();
  }, []);

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="flex h-[60vh] items-center justify-center">{error}</div>;
  }

  if (!profile) {
    return <div className="flex h-[60vh] items-center justify-center">Profile not found</div>;
  }

  return (
    <div className="min-h-screen bg-[#080D18] text-[#F4F6FC] p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center">
          <h1 className="text-3xl font-bold text-white mb-6">Profile</h1>
        </div>

        <div className="bg-[#101827/80] rounded-lg p-6">
          {!editMode ? (
            <div>
              <div className="space-y-4">
                <div className="flex items-center">
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="Avatar"
                      className="w-16 h-16 rounded-full mr-4"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-500 flex items-center justify-center text-white">
                      {profile.username?.charAt(0) ?? "?"}
                    </div>
                  )}
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-white">
                      {profile.display_name || profile.username}
                    </h2>
                    <p className="text-sm text-gray-400">
                      @{profile.username}
                    </p>
                  </div>
                </div>

                {profile.bio && (
                  <div className="pt-4 border-t">
                    <p className="text-gray-300">{profile.bio}</p>
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <Button
                    onClick={() => setEditMode(true)}
                    className="bg-[#7047F5] hover:bg-[#5a37f5]"
                  >
                    Edit Profile
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <form className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display Name</Label>
                  <Input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">Bio</Label>
                  <textarea
                    id="bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                    rows={4}
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditMode(false);
                      setDisplayName(profile.display_name || "");
                      setBio(profile.bio || "");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={updateProfile}
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>

        <div className="mt-8">
          <h2 className="text-2xl font-bold text-white mb-4">Personal Library</h2>
          <div className="bg-[#101827/80] rounded-lg p-4">
            <p className="text-gray-400">
              Your personal anime library will appear here once you add some anime.
            </p>
            <div className="mt-4 text-center">
              <Link
                href="/library"
                className="text-[#7047F5] hover:underline"
              >
                View Your Library →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}