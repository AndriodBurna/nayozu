"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface CommentProps {
  comment: {
    id: string;
    user_id: string;
    anime_id: string;
    parent_comment_id: string | null;
    body: string;
    is_spoiler: boolean;
    is_hidden: boolean;
    created_at: string;
    updated_at: string;
    profiles: {
      username: string;
      avatar_url: string | null;
    };
    // Optionally, we can include replies if they are fetched together
    // replies?: CommentProps[];
  };
  // We can pass a function to add a reply (to update the parent comment's replies)
  onReplyAdd?: (commentId: string, newComment: any) => void;
  // We can pass a function to update a comment (edit)
  onCommentUpdate?: (commentId: string, updates: Partial<any>) => void;
  // We can pass a function to delete a comment
  onCommentDelete?: (commentId: string) => void;
  // We can pass a function to report a comment
  onCommentReport?: (commentId: string, reason: string, explanation: string) => void;
}

export default function Comment({
  comment,
  onReplyAdd,
  onCommentUpdate,
  onCommentDelete,
  onCommentReport,
}: CommentProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null); // 'moderator' | 'admin' | null
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);

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

  const isAuthor = userId === comment.user_id;
  const canModerate = !!userRole && (userRole === "moderator" || userRole === "admin");
  const canSeeHidden = isAuthor || canModerate;
  const shouldShowComment = !comment.is_hidden || canSeeHidden;

  const handleReply = async () => {
    if (!replyBody.trim()) return;
    if (!userId) {
      alert("Please log in to reply");
      return;
    }
    setIsReplying(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: newComment, error } = await supabase
        .from("anime_comments")
        .insert({
          user_id: userId,
          anime_id: comment.anime_id,
          parent_comment_id: comment.id,
          body: replyBody.trim(),
          is_spoiler: false,
          is_hidden: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      setReplyBody("");
      setIsReplying(false);
      if (onReplyAdd) {
        onReplyAdd(comment.id, newComment);
      }
    } catch (err: any) {
      setError(err.message || "Failed to post reply");
    } finally {
      setIsReplying(false);
    }
  };

  const handleEditSave = async () => {
    if (!isAuthor) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("anime_comments")
        .update({
          body: editBody.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", comment.id);

      if (error) throw error;
      setIsEditing(false);
      if (onCommentUpdate) {
        onCommentUpdate(comment.id, { body: editBody.trim() });
      }
    } catch (err: any) {
      setError(err.message || "Failed to update comment");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isAuthor && !canModerate) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("anime_comments")
        .delete()
        .eq("id", comment.id);

      if (error) throw error;
      if (onCommentDelete) {
        onCommentDelete(comment.id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete comment");
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
          content_type: "comment",
          content_id: comment.id,
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

  if (!shouldShowComment) {
    return (
      <div className="border border-gray-700 rounded-lg p-4 bg-[#101827/80] text-center text-gray-500">
        This comment is hidden.
      </div>
    );
  }

  const createdAt = new Date(comment.created_at);
  const updatedAt = new Date(comment.updated_at);
  const isEdited = updatedAt > createdAt;

  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-[#101827/80]">
      <div className="flex items-start space-x-3">
        {comment.profiles.avatar_url ? (
          <img
            src={comment.profiles.avatar_url}
            alt={`${comment.profiles.username}'s avatar`}
            className="h-10 w-10 rounded-full bg-gray-600"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-gray-600 flex items-center justify-center text-white">
            {comment.profiles.username
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
        )}
        <div className="flex-1 space-y-2">
          <div className="flex items-center space-x-2">
            <h3 className="font-semibold text-white">{comment.profiles.username}</h3>
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </span>
            {isEdited && (
              <span className="ml-2 text-xs text-gray-400">
                (edited {formatDistanceToNow(updatedAt, { addSuffix: true })})
              </span>
            )}
            {comment.is_hidden && !canSeeHidden && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-red-600/20 text-red-300 rounded">
                Hidden
              </span>
            )}
          </div>

          {/* Spoiler handling */}
          {comment.is_spoiler && !spoilerRevealed ? (
            <div className="mb-3 text-center cursor-pointer text-[#F05BBD] hover:underline">
              Spoiler: Click to reveal
            </div>
          ) : (
            <p className="text-gray-200 leading-relaxed">
              {comment.body}
            </p>
          )}

          {!comment.is_spoiler || spoilerRevealed ? (
            <>
              {isAuthor && (
                <div className="mt-2 flex items-center space-x-3 text-sm">
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
                </div>
              )}
              {!isAuthor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // We'll open a report modal; for now, we'll just call a function that expects reason and explanation
                    // We'll implement a simple prompt for reason and explanation
                    const reason = prompt("Select reason: spam, harassment, spoiler, inappropriate, other");
                    if (!reason) return;
                    const explanation = prompt("Please explain why you're reporting this comment (optional):");
                    handleReport(reason, explanation || "");
                  }}
                  className="hover:text-[#F05BBD]"
                >
                  Report
                </Button>
              )}
            </>
          ) : null}

          {/* Spoiler reveal button */}
          {comment.is_spoiler && !spoilerRevealed && (
            <div className="mt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSpoilerRevealed(true)}
                className="hover:bg-[#F05BBD]/20 text-[#F05BBD]"
              >
                Reveal Spoiler
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Reply form */}
      {isReplying && (
        <div className="mt-4">
          <form onSubmit={(e) => {
            e.preventDefault();
            handleReply();
          }} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reply-body">Reply</Label>
              <Textarea
                id="reply-body"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                rows={3}
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
              {loading ? "Replying..." : "Reply"}
            </Button>
          </form>
        </div>
      )}

      {/* Edit form */}
      {isEditing && (
        <div className="mt-4">
          <form onSubmit={(e) => {
            e.preventDefault();
            handleEditSave();
          }} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-body">Edit Comment</Label>
              <Textarea
                id="edit-body"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
                rows={3}
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