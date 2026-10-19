"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface ReviewCardProps {
  review: {
    id: string;
    user_id: string;
    anime_id: string;
    title: string | null;
    body: string;
    created_at: string;
    updated_at: string;
    profiles: {
      username: string;
      avatar_url: string | null;
    };
  };
}

export default function ReviewCard({ review }: ReviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState<string>(review.title ?? "");
  const [editBody, setEditBody] = useState<string>(review.body);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Fetch current user ID once
  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
      }
    };
    fetchUser();
  }, []);

  const isAuthor = userId === review.user_id;

  const handleDelete = async () => {
    if (!isAuthor) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("anime_reviews")
        .delete()
        .eq("id", review.id);

      if (error) throw error;
    } catch (err: any) {
      setError(err.message || "Failed to delete review");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isAuthor) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("anime_reviews")
        .update({
          title: editTitle.trim() || null,
          body: editBody.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", review.id);

      if (error) throw error;
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to update review");
    } finally {
      setLoading(false);
    }
  };

  const handleReport = async (reason: string, explanation: string) => {
    if (!userId) {
      alert("Please log in to report");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("content_reports")
        .insert({
          reporter_id: userId,
          content_type: "review",
          content_id: review.id,
          reason,
          explanation,
          status: "pending",
          created_at: new Date().toISOString(),
        });

      if (error) throw error;
      alert("Report submitted");
    } catch (err: any) {
      setError(err.message || "Failed to submit report");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center space-x-2">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center space-x-2 text-red-500">{error}</div>;
  }

  const createdAt = new Date(review.created_at);
  const updatedAt = new Date(review.updated_at);
  const isEdited = updatedAt > createdAt;

  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-[#101827/80]">
      <div className="flex items-start space-x-3">
        {review.profiles.avatar_url ? (
          <img
            src={review.profiles.avatar_url}
            alt={`${review.profiles.username}'s avatar`}
            className="h-10 w-10 rounded-full bg-gray-600"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-gray-600 flex items-center justify-center text-white">
            {review.profiles.username
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
        )}
        <div className="flex-1 space-y-2">
          <div className="flex items-center space-x-2">
            <h3 className="font-semibold text-white">{review.profiles.username}</h3>
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </span>
            {isEdited && (
              <span className="ml-2 text-xs text-gray-400">
                (edited {formatDistanceToNow(updatedAt, { addSuffix: true })})
              </span>
            )}
          </div>

          {review.title && (
            <h4 className="font-medium text-[#F05BBD] mb-1">{review.title}</h4>
          )}

          <p className="text-gray-200 leading-relaxed">{review.body}</p>

          <div className="mt-4 flex items-center space-x-3 text-sm">
            {isAuthor && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="hover:bg-gray-700"
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  className="hover:bg-red-700"
                >
                  Delete
                </Button>
              </>
            )}
            {!isAuthor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const reason = prompt("Select reason: spam, harassment, spoiler, inappropriate, other");
                  if (!reason) return;
                  const explanation = prompt("Please explain why you're reporting this review (optional):");
                  handleReport(reason, explanation || "");
                }}
                className="hover:text-[#F05BBD]"
              >
                Report
              </Button>
            )}
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="mt-4">
          <form onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-title">Title (optional)</Label>
              <Input
                id="edit-title"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-body">Body</Label>
              <Textarea
                id="edit-body"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                rows={4}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(false)}
                className="hover:bg-gray-700"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={loading}
                className="hover:bg-[#7047F5]/80"
              >
                {loading ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}