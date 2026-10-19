"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Report {
  id: string;
  reporter_id: string;
  content_type: "review" | "comment" | "rating";
  content_id: string;
  reason: string;
  explanation: string | null;
  status: "pending" | "resolved" | "dismissed";
  resolver_id: string | null;
  resolution_notes: string | null;
  created_at: string;
  // Reporter info
  reporter_username: string;
  reporter_avatar_url: string | null;
  // Content info (depends on content_type)
  anime_title: string;
  content_preview: string; // short preview of the content
  user_id?: string;
  content_author_user_id?: string;
  content_author_username: string;
  content_author_avatar_url: string | null;
}

interface UserRestriction {
  id: string;
  user_id: string;
  reason: string;
  restricted_until: string | null;
  created_at: string;
  created_by: string;
  // User info
  username: string;
  avatar_url: string | null;
}

export default function ModerationPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [userRestrictions, setUserRestrictions] = useState<UserRestriction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null); // 'moderator' | 'admin' | null
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [restrictionReason, setRestrictionReason] = useState("");
  const [restrictionUntil, setRestrictionUntil] = useState(""); // ISO date string

  // Fetch current user ID and role
  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        // Fetch user role
        const { data: roleData, error: roleError } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (!roleError && roleData) {
          setUserRole(roleData.role);
        }
      }
    };
    fetchUser();
  }, []);

  // Fetch all reports with details
  useEffect(() => {
    const fetchReports = async () => {
      if (!userId) return;
      try {
        setLoading(true);
        const supabase = createClient();

        // Fetch reports
        const { data: reportsData, error: reportsError } = await supabase
          .from("content_reports")
          .select("id, reporter_id, content_type, content_id, reason, explanation, status, resolver_id, resolution_notes, created_at")
          .order("created_at", { ascending: false });

        if (reportsError) throw reportsError;

        // For each report, fetch reporter, content, and anime details
        const reportsWithDetails: Report[] = [];

        for (const report of (reportsData || [])) {
          let anime_title = "";
          let content_preview = "";
          let content_author_user_id = "";
          let content_author_username = "";
          let content_author_avatar_url: string | null = null;
          let reporter_username = "";
          let reporter_avatar_url: string | null = null;

          // Fetch reporter profile
          if (report.reporter_id) {
            const { data: reporterProfile } = await supabase
              .from("profiles")
              .select("username, avatar_url")
              .eq("id", report.reporter_id)
              .maybeSingle();

            if (reporterProfile) {
              reporter_username = reporterProfile.username || "";
              reporter_avatar_url = reporterProfile.avatar_url || null;
            }
          }

          if (report.content_type === "review") {
            const { data: reviewData } = await supabase
              .from("anime_reviews")
              .select("id, body, title, anime_id, user_id")
              .eq("id", report.content_id)
              .maybeSingle();

            if (reviewData) {
              content_preview = reviewData.title || reviewData.body.substring(0, 100);
              content_author_user_id = reviewData.user_id;

              const { data: authorProfile } = await supabase
                .from("profiles")
                .select("username, avatar_url")
                .eq("id", reviewData.user_id)
                .maybeSingle();

              if (authorProfile) {
                content_author_username = authorProfile.username || "";
                content_author_avatar_url = authorProfile.avatar_url || null;
              }

              const { data: animeRow } = await supabase
                .from("anime")
                .select("title_romaji, title_english")
                .or(`external_id.eq.${reviewData.anime_id},id.eq.${reviewData.anime_id}`)
                .maybeSingle();

              anime_title = animeRow?.title_english || animeRow?.title_romaji || `Anime ${reviewData.anime_id}`;
            }
          } else if (report.content_type === "comment") {
            const { data: commentData } = await supabase
              .from("anime_comments")
              .select("id, body, is_spoiler, anime_id, user_id")
              .eq("id", report.content_id)
              .maybeSingle();

            if (commentData) {
              content_preview = commentData.is_spoiler
                ? "[Spoiler hidden]"
                : commentData.body.substring(0, 100);
              content_author_user_id = commentData.user_id;

              const { data: authorProfile } = await supabase
                .from("profiles")
                .select("username, avatar_url")
                .eq("id", commentData.user_id)
                .maybeSingle();

              if (authorProfile) {
                content_author_username = authorProfile.username || "";
                content_author_avatar_url = authorProfile.avatar_url || null;
              }

              const { data: animeRow } = await supabase
                .from("anime")
                .select("title_romaji, title_english")
                .or(`external_id.eq.${commentData.anime_id},id.eq.${commentData.anime_id}`)
                .maybeSingle();

              anime_title = animeRow?.title_english || animeRow?.title_romaji || `Anime ${commentData.anime_id}`;
            }
          } else if (report.content_type === "rating") {
            const { data: ratingData } = await supabase
              .from("anime_ratings")
              .select("id, rating, anime_id, user_id")
              .eq("id", report.content_id)
              .maybeSingle();

            if (ratingData) {
              content_preview = `Rating: ${ratingData.rating}/10`;
              content_author_user_id = ratingData.user_id;

              const { data: authorProfile } = await supabase
                .from("profiles")
                .select("username, avatar_url")
                .eq("id", ratingData.user_id)
                .maybeSingle();

              if (authorProfile) {
                content_author_username = authorProfile.username || "";
                content_author_avatar_url = authorProfile.avatar_url || null;
              }

              const { data: animeRow } = await supabase
                .from("anime")
                .select("title_romaji, title_english")
                .or(`external_id.eq.${ratingData.anime_id},id.eq.${ratingData.anime_id}`)
                .maybeSingle();

              anime_title = animeRow?.title_english || animeRow?.title_romaji || `Anime ${ratingData.anime_id}`;
            }
          }

          reportsWithDetails.push({
            ...report,
            reporter_username,
            reporter_avatar_url,
            anime_title,
            content_preview,
            user_id: content_author_user_id,
            content_author_user_id,
            content_author_username,
            content_author_avatar_url,
          });
        }

        setReports(reportsWithDetails);
      } catch (err: any) {
        setError(err.message || "Failed to load reports");
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, [userId]);

  // Fetch all user restrictions
  useEffect(() => {
    const fetchRestrictions = async () => {
      if (!userId) return;
      try {
        const supabase = createClient();
        const { data: restrictionsData, error: restrictionsError } = await supabase
          .from("user_restrictions")
          .select("id, user_id, reason, restricted_until, created_at, created_by")
          .order("created_at", { ascending: false });

        if (restrictionsError) throw restrictionsError;

        const enrichedRestrictions: UserRestriction[] = [];
        for (const r of (restrictionsData || [])) {
          let username = "Unknown user";
          let avatar_url: string | null = null;
          if (r.user_id) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("username, avatar_url")
              .eq("id", r.user_id)
              .maybeSingle();
            if (prof) {
              username = prof.username || "Unknown user";
              avatar_url = prof.avatar_url || null;
            }
          }
          enrichedRestrictions.push({
            ...r,
            username,
            avatar_url,
          });
        }

        setUserRestrictions(enrichedRestrictions);
      } catch (err: any) {
        console.error("Failed to load restrictions:", err);
      }
    };

    fetchRestrictions();
  }, [userId]);

  const isModeratorOrAdmin = !!userRole && (userRole === "moderator" || userRole === "admin");

  const handleResolveReport = async (reportId: string, resolverNotes: string) => {
    if (!isModeratorOrAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("content_reports")
        .update({
          status: "resolved",
          resolver_id: userId,
          resolution_notes: resolverNotes,
        })
        .eq("id", reportId);

      if (error) throw error;
      // Refetch reports
      // We'll refetch by triggering the effect again? We'll just update the state optimistically
      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId
            ? {
                ...report,
                status: "resolved",
                resolver_id: userId,
                resolution_notes: resolverNotes,
              }
            : report
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to resolve report");
    } finally {
      setLoading(false);
    }
  };

  const handleDismissReport = async (reportId: string, resolverNotes: string) => {
    if (!isModeratorOrAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("content_reports")
        .update({
          status: "dismissed",
          resolver_id: userId,
          resolution_notes: resolverNotes,
        })
        .eq("id", reportId);

      if (error) throw error;
      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId
            ? {
                ...report,
                status: "dismissed",
                resolver_id: userId,
                resolution_notes: resolverNotes,
              }
            : report
        )
      );
    } catch (err: any) {
      setError(err.message || "Failed to dismiss report");
    } finally {
      setLoading(false);
    }
  };

  const handleAddRestriction = async () => {
    if (!isModeratorOrAdmin) return;
    if (!restrictionReason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: newRestriction, error } = await supabase
        .from("user_restrictions")
        .insert({
          user_id: selectedReport?.user_id ?? "", // We need to get the user_id from the reported content author
          reason: restrictionReason.trim(),
          restricted_until: restrictionUntil || null,
          created_by: userId,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      // Add to restrictions list
      setUserRestrictions((prev) => [
        ...prev,
        {
          ...newRestriction,
          username: "", // We'll need to fetch the username, but for now we can leave it blank and refetch
          avatar_url: null,
        },
      ]);
      // Clear form
      setRestrictionReason("");
      setRestrictionUntil("");
      setSelectedReport(null);
    } catch (err: any) {
      setError(err.message || "Failed to add restriction");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveRestriction = async (restrictionId: string) => {
    if (!isModeratorOrAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_restrictions")
        .delete()
        .eq("id", restrictionId);

      if (error) throw error;
      setUserRestrictions((prev) => prev.filter((r) => r.id !== restrictionId));
    } catch (err: any) {
      setError(err.message || "Failed to remove restriction");
    } finally {
      setLoading(false);
    }
  };

  if (!isModeratorOrAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-foreground mb-4">Access Denied</h1>
          <p className="text-muted-foreground">
            You do not have permission to access the moderation interface.
          </p>
          <Link href="/" className="text-primary hover:underline">
            ← Return to Home
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  if (error) return <div className="flex h-[60vh] items-center justify-center">{error}</div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col items-center mb-6">
          <Link
            href="/"
            className="mb-4 text-sm text-primary hover:underline"
          >
            ← Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Moderation Interface</h1>
          <p className="text-muted-foreground">
            Manage reports, review content, and apply user restrictions.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          {/* Reports Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white mb-2">Reports</h2>
            {reports.length === 0 ? (
              <p className="text-center text-muted-foreground">No reports found.</p>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="border border-border rounded-lg p-4 bg-card text-card-foreground"
                  >
                    <div className="flex items-start space-x-3">
                      {report.reporter_avatar_url ? (
                        <img
                          src={report.reporter_avatar_url}
                          alt={`${report.reporter_username}'s avatar`}
                          className="h-10 w-10 rounded-full bg-muted"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                          {report.reporter_username
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center space-x-2 text-sm">
                          <h3 className="font-semibold text-foreground">{report.reporter_username}</h3>
                          <span className="text-xs text-muted-foreground">
                            {new Date(report.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-foreground">Reported {report.content_type}:</span>
                          <p className="text-muted-foreground mt-1">{report.content_preview}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Anime: {report.anime_title}
                          </p>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-foreground">Reason:</span>
                          <p className="text-muted-foreground mt-1">{report.reason}</p>
                        </div>

                        {report.explanation && (
                          <div className="mt-2">
                            <span className="font-medium text-foreground">Explanation:</span>
                            <p className="text-muted-foreground mt-1">{report.explanation}</p>
                          </div>
                        )}

                        <div className="mt-4 flex items-center space-x-3 text-sm">
                          <span className="text-xs text-muted-foreground">
                            Status: {report.status}
                          </span>
                          {isModeratorOrAdmin && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const notes = prompt("Enter resolution notes (optional):");
                                  handleResolveReport(report.id, notes || "");
                                }}
                              >
                                Resolve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const notes = prompt("Enter dismissal notes (optional):");
                                  handleDismissReport(report.id, notes || "");
                                }}
                                className="hover:text-destructive"
                              >
                                Dismiss
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User Restrictions Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground mb-2">User Restrictions</h2>
            {userRestrictions.length === 0 ? (
              <p className="text-center text-muted-foreground">No active restrictions.</p>
            ) : (
              <div className="space-y-3">
                {userRestrictions.map((restriction) => (
                  <div
                    key={restriction.id}
                    className="border border-border rounded-lg p-4 bg-card text-card-foreground"
                  >
                    <div className="flex items-start space-x-3">
                      {restriction.avatar_url ? (
                        <img
                          src={restriction.avatar_url}
                          alt={`${restriction.username}'s avatar`}
                          className="h-10 w-10 rounded-full bg-muted"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                          {restriction.username
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center space-x-2 text-sm">
                          <h3 className="font-semibold text-foreground">{restriction.username}</h3>
                          <span className="text-xs text-muted-foreground">
                            {new Date(restriction.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-foreground">Reason:</span>
                          <p className="text-muted-foreground mt-1">{restriction.reason}</p>
                        </div>

                        {restriction.restricted_until && (
                          <div className="mt-2">
                            <span className="font-medium text-foreground">Restricted Until:</span>
                            <p className="text-muted-foreground mt-1">
                              {new Date(restriction.restricted_until).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        {!restriction.restricted_until && (
                          <div className="mt-2">
                            <span className="font-medium text-foreground">Restricted Until:</span>
                            <p className="text-muted-foreground mt-1">Indefinite</p>
                          </div>
                        )}

                        <div className="mt-4 flex justify-end space-x-2">
                          {isModeratorOrAdmin && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveRestriction(restriction.id)}
                            >
                              Remove Restriction
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Restriction Form */}
            {selectedReport && (
              <div className="mt-6 border border-border rounded-lg p-4 bg-card text-card-foreground">
                <h2 className="text-xl font-semibold text-foreground mb-2">Add Restriction for User</h2>
                <p className="text-muted-foreground mb-4">
                  You are about to restrict the user who posted the following content:
                </p>
                <div className="border border-border rounded-lg p-3 mb-4">
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Content:</strong> {selectedReport.content_preview}
                  </p>
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Anime:</strong> {selectedReport.anime_title}
                  </p>
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Reported by:</strong> {selectedReport.reporter_username}
                  </p>
                </div>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  handleAddRestriction();
                }} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="restriction-reason">Reason for Restriction</Label>
                    <Input
                      id="restriction-reason"
                      value={restrictionReason}
                      onChange={(e) => setRestrictionReason(e.target.value)}
                      placeholder="e.g., harassment, spam, repeated violations"
                      className="w-full border-input bg-background text-foreground focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="restriction-until">Restrict Until (optional)</Label>
                    <Input
                      id="restriction-until"
                      type="date"
                      value={restrictionUntil}
                      onChange={(e) => setRestrictionUntil(e.target.value)}
                      className="w-full border-input bg-background text-foreground focus:ring-ring"
                    />
                  </div>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={loading}
                  >
                    {loading ? "Adding..." : "Add Restriction"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedReport(null)}
                    className="ml-2"
                  >
                    Cancel
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}