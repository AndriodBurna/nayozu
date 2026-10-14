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

        // We'll fetch reports and then fetch related data in parallel
        const { data: reportsData, error: reportsError } = await supabase
          .from("content_reports")
          .select(`
            id,
            reporter_id,
            content_type,
            content_id,
            reason,
            explanation,
            status,
            resolver_id,
            resolution_notes,
            created_at,
            reporter:profiles!reporter_id (
              username,
              avatar_url
            )
          `)
          .order("created_at", { ascending: false });

        if (reportsError) throw reportsError;

        // For each report, fetch content details
        const reportsWithDetails: Report[] = [];

        for (const report of reportsData) {
          let anime_title = "";
          let content_preview = "";
          let content_author_username = "";
          let content_author_avatar_url: string | null = null;

          if (report.content_type === "review") {
            const { data: reviewData, error: reviewError } = await supabase
              .from("anime_reviews")
              .select(`
                id,
                body,
                title,
                anime_id,
                anime:anime_id (
                  title
                ),
                author:profiles!user_id (
                  username,
                  avatar_url
                )
              `)
              .eq("id", report.content_id)
              .single();

            if (!reviewError && reviewData) {
              anime_title = reviewData.anime?.title || "";
              content_preview = reviewData.title || reviewData.body.substring(0, 100);
              content_author_username = reviewData.author?.username || "";
              content_author_avatar_url = reviewData.author?.avatar_url || null;
            }
          } else if (report.content_type === "comment") {
            const { data: commentData, error: commentError } = await supabase
              .from("anime_comments")
              .select(`
                id,
                body,
                is_spoiler,
                anime_id,
                anime:anime_id (
                  title
                ),
                author:profiles!user_id (
                  username,
                  avatar_url
                )
              `)
              .eq("id", report.content_id)
              .single();

            if (!commentError && commentData) {
              anime_title = commentData.anime?.title || "";
              // If spoiler, we might want to show a note
              content_preview = commentData.is_spoiler
                ? "[Spoiler hidden]"
                : commentData.body.substring(0, 100);
              content_author_username = commentData.author?.username || "";
              content_author_avatar_url = commentData.author?.avatar_url || null;
            }
          } else if (report.content_type === "rating") {
            const { data: ratingData, error: ratingError } = await supabase
              .from("anime_ratings")
              .select(`
                id,
                rating,
                anime_id,
                anime:anime_id (
                  title
                ),
                author:profiles!user_id (
                  username,
                  avatar_url
                )
              `)
              .eq("id", report.content_id)
              .single();

            if (!ratingError && ratingData) {
              anime_title = ratingData.anime?.title || "";
              content_preview = `Rating: ${ratingData.rating}/10`;
              content_author_username = ratingData.author?.username || "";
              content_author_avatar_url = ratingData.author?.avatar_url || null;
            }
          }

          reportsWithDetails.push({
            ...report,
            reporter_username: report.reporter?.username || "",
            reporter_avatar_url: report.reporter?.avatar_url || null,
            anime_title,
            content_preview,
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
          .select(`
            id,
            user_id,
            reason,
            restricted_until,
            created_at,
            created_by,
            user:user_id (
              username,
              avatar_url
            )
          `)
          .order("created_at", { ascending: false });

        if (restrictionsError) throw restrictionsError;

        setUserRestrictions(
          restrictionsData.map((r: any) => ({
            ...r,
            username: r.user?.username || "",
            avatar_url: r.user?.avatar_url || null,
          }))
        );
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
      <div className="min-h-screen bg-[#080D18] text-[#F4F6FC] p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-4">Access Denied</h1>
          <p className="text-gray-400">
            You do not have permission to access the moderation interface.
          </p>
          <Link href="/" className="text-[#7047F5] hover:underline">
            ← Return to Home
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  if (error) return <div className="flex h-[60vh] items-center justify-center">{error}</div>;

  return (
    <div className="min-h-screen bg-[#080D18] text-[#F4F6FC] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col items-center mb-6">
          <Link
            href="/"
            className="mb-4 text-sm text-[#7047F5] hover:underline"
          >
            ← Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-white">Moderation Interface</h1>
          <p className="text-gray-400">
            Manage reports, review content, and apply user restrictions.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          {/* Reports Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white mb-2">Reports</h2>
            {reports.length === 0 ? (
              <p className="text-center text-gray-400">No reports found.</p>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="border border-gray-700 rounded-lg p-4 bg-[#101827/80]"
                  >
                    <div className="flex items-start space-x-3">
                      {report.reporter_avatar_url ? (
                        <img
                          src={report.reporter_avatar_url}
                          alt={`${report.reporter_username}'s avatar`}
                          className="h-10 w-10 rounded-full bg-gray-600"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gray-600 flex items-center justify-center text-white">
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
                          <h3 className="font-semibold text-white">{report.reporter_username}</h3>
                          <span className="text-xs text-gray-400">
                            {new Date(report.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-white">Reported {report.content_type}:</span>
                          <p className="text-gray-200 mt-1">{report.content_preview}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Anime: {report.anime_title}
                          </p>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-white">Reason:</span>
                          <p className="text-gray-200 mt-1">{report.reason}</p>
                        </div>

                        {report.explanation && (
                          <div className="mt-2">
                            <span className="font-medium text-white">Explanation:</span>
                            <p className="text-gray-200 mt-1">{report.explanation}</p>
                          </div>
                        )}

                        <div className="mt-4 flex items-center space-x-3 text-sm">
                          <span className="text-xs text-gray-400">
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
                                className="hover:bg-gray-700"
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
                                className="hover:text-[#F05BBD]"
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
            <h2 className="text-xl font-semibold text-white mb-2">User Restrictions</h2>
            {userRestrictions.length === 0 ? (
              <p className="text-center text-gray-400">No active restrictions.</p>
            ) : (
              <div className="space-y-3">
                {userRestrictions.map((restriction) => (
                  <div
                    key={restriction.id}
                    className="border border-gray-700 rounded-lg p-4 bg-[#101827/80]"
                  >
                    <div className="flex items-start space-x-3">
                      {restriction.avatar_url ? (
                        <img
                          src={restriction.avatar_url}
                          alt={`${restriction.username}'s avatar`}
                          className="h-10 w-10 rounded-full bg-gray-600"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gray-600 flex items-center justify-center text-white">
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
                          <h3 className="font-semibold text-white">{restriction.username}</h3>
                          <span className="text-xs text-gray-400">
                            {new Date(restriction.created_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="mt-2">
                          <span className="font-medium text-white">Reason:</span>
                          <p className="text-gray-200 mt-1">{restriction.reason}</p>
                        </div>

                        {restriction.restricted_until && (
                          <div className="mt-2">
                            <span className="font-medium text-white">Restricted Until:</span>
                            <p className="text-gray-200 mt-1">
                              {new Date(restriction.restricted_until).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        {!restriction.restricted_until && (
                          <div className="mt-2">
                            <span className="font-medium text-white">Restricted Until:</span>
                            <p className="text-gray-200 mt-1">Indefinite</p>
                          </div>
                        )}

                        <div className="mt-4 flex justify-end space-x-2">
                          {isModeratorOrAdmin && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveRestriction(restriction.id)}
                              className="hover:bg-red-700"
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
              <div className="mt-6 border border-gray-700 rounded-lg p-4 bg-[#101827/80]">
                <h2 className="text-xl font-semibold text-white mb-2">Add Restriction for User</h2>
                <p className="text-gray-400 mb-4">
                  You are about to restrict the user who posted the following content:
                </div>
                <div className="border border-gray-600 rounded-lg p-3 mb-4">
                  <p className="text-gray-200">
                    <strong>Content:</strong> {selectedReport.content_preview}
                  </p>
                  <p className="text-gray-200">
                    <strong>Anime:</strong> {selectedReport.anime_title}
                  </p>
                  <p className="text-gray-200">
                    <strong>Reported by:</strong> {selectedReport.reporter_username}
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
                      className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="restriction-until">Restrict Until (optional)</Label>
                    <Input
                      id="restriction-until"
                      type="date"
                      value={restrictionUntil}
                      onChange={(e) => setRestrictionUntil(e.target.value)}
                      className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                    />
                  </div>

                  {error && <p className="text-sm text-red-500">{error}</p>}

                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={loading}
                    className="hover:bg-[#7047F5]/80"
                  >
                    {loading ? "Adding..." : "Add Restriction"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedReport(null)}
                    className="hover:bg-gray-700"
                    ml={2}
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