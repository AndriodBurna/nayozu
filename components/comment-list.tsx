"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Comment from "./comment";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface CommentListProps {
  animeId: string; // external anime ID as string
}

interface CommentWithReplies {
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
  replies: CommentWithReplies[];
}

export default function CommentList({ animeId }: CommentListProps) {
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null); // comment ID we are replying to
  const [replyBody, setReplyBody] = useState("");

  // Fetch all comments for the anime and build a tree
  useEffect(() => {
    const fetchComments = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        // Fetch all comments for this anime, ordered by created_at ascending (so older first)
        const { data, error } = await supabase
          .from("anime_comments")
          .select(`
            id,
            user_id,
            anime_id,
            parent_comment_id,
            body,
            is_spoiler,
            is_hidden,
            created_at,
            updated_at,
            profiles!inner (
              username,
              avatar_url
            )
          `)
          .eq("anime_id", animeId)
          .order("created_at", { ascending: true });

        if (error) throw error;

        // Build a map of comment ID to comment object
        const commentMap = new Map<string, CommentWithReplies>();
        const rootComments: CommentWithReplies[] = [];

        data.forEach((comment: any) => {
          const commentWithReplies: CommentWithReplies = {
            ...comment,
            replies: [],
          };
          commentMap.set(comment.id, commentWithReplies);
        });

        // Assign replies to their parents
        data.forEach((comment: any) => {
          const commentWithReplies = commentMap.get(comment.id);
          if (!commentWithReplies) return;

          if (comment.parent_comment_id) {
            const parent = commentMap.get(comment.parent_comment_id);
            if (parent) {
              parent.replies.push(commentWithReplies);
            }
          } else {
            rootComments.push(commentWithReplies);
          }
        });

        // Sort root comments by created_at (ascending) and sort replies within each comment by created_at (ascending)
        rootComments.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        rootComments.forEach((comment) => {
          comment.replies.sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });

        setComments(rootComments);
      } catch (err: any) {
        setError(err.message || "Failed to load comments");
      } finally {
        setLoading(false);
      }
    };

    fetchComments();
  }, [animeId]);

  const handleTopLevelCommentSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }
      const { data: newComment, error } = await supabase
        .from("anime_comments")
        .insert({
          user_id: user.id,
          anime_id: animeId,
          parent_comment_id: null,
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
      // Refetch comments to include the new one
      // We could optimistically add it, but for simplicity we refetch
      // We'll call fetchComments again via the effect by triggering a state change?
      // Instead, we can update the comments state directly.
      // We'll refetch by resetting the loading state and calling fetchComments again.
      // But we can also update the map and rootComments manually.
      // For now, we'll refetch by setting loading to true and then calling fetchComments again.
      // We'll do that by resetting the comments array and letting the effect run again?
      // Actually, we can just call the fetchComments function again.
      // We'll do that after a short timeout to avoid infinite loop?
      // Instead, we'll update the state optimistically.
      // We'll add the new comment to the root comments (since it's a top-level comment).
      const newCommentWithReplies: CommentWithReplies = {
        ...newComment,
        replies: [],
      };
      setComments((prev) => [...prev, newCommentWithReplies]);
    } catch (err: any) {
      setError(err.message || "Failed to submit comment");
    } finally {
      setLoading(false);
    }
  };

  const handleReplySubmit = async (parentId: string, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }
      const { data: newComment, error } = await supabase
        .from("anime_comments")
        .insert({
          user_id: user.id,
          anime_id: animeId,
          parent_comment_id: parentId,
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
      // Optimistically update the comment's replies
      setComments((prev) =>
        prev.map((comment) => {
          if (comment.id === parentId) {
            const newCommentWithReplies: CommentWithReplies = {
              ...newComment,
              replies: [],
            };
            return {
              ...comment,
              replies: [...comment.replies, newCommentWithReplies],
            };
          }
          return comment;
        })
      );
    } catch (err: any) {
      setError(err.message || "Failed to submit reply");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="flex h-[60vh] items-center justify-center">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top-level comment form */}
      <div className="border border-gray-700 rounded-lg p-4 bg-[#101827/80]">
        <h3 className="font-semibold text-white mb-2">Add a comment</h3>
        <form onSubmit={handleTopLevelCommentSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="top-level-comment-body">Comment</Label>
            <Textarea
              id="top-level-comment-body"
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
            {loading ? "Posting..." : "Post Comment"}
          </Button>
        </form>
      </div>

      {/* Comments list */}
      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-center text-gray-400">No comments yet. Be the first to comment!</p>
        ) : (
          <>
            {comments.map((comment) => (
              <Comment
                key={comment.id}
                comment={comment}
                onReplyAdd = (parentId, newComment) => {
                  // Optimistically add the reply to the comment's replies
                  setComments((prev) =>
                    prev.map((c) => {
                      if (c.id === parentId) {
                        const newCommentWithReplies: CommentWithReplies = {
                          ...newComment,
                          replies: [],
                        };
                        return {
                          ...c,
                          replies: [...c.replies, newCommentWithReplies],
                        };
                      }
                      return c;
                    })
                  );
                }
                onCommentUpdate = (commentId, updates) => {
                  setComments((prev) =>
                    prev.map((comment) => {
                      if (comment.id === commentId) {
                        return { ...comment, ...updates };
                      }
                      // Also check in replies
                      const updatedReplies = comment.replies.map((reply) => {
                        if (reply.id === commentId) {
                          return { ...reply, ...updates };
                        }
                        return reply;
                      });
                      if (updatedReplies.some((r) => r.id === commentId)) {
                        return { ...comment, replies: updatedReplies };
                      }
                      return comment;
                    })
                  );
                }
                onCommentDelete = (commentId) => {
                  setComments((prev) => {
                    // Remove from root comments or from replies
                    const newRoot = prev.filter((comment) => comment.id !== commentId);
                    // Also remove from replies of each comment
                    const updated = newRoot.map((comment) => ({
                      ...comment,
                      replies: comment.replies.filter((reply) => reply.id !== commentId),
                    }));
                    return updated;
                  });
                }
                onCommentReport = (commentId, reason, explanation) => {
                  // We'll just call an alert for now; in a real app we might show a modal
                  alert(`Report submitted for comment ${commentId}`);
                }
              />
              {/* Replies are handled within the Comment component via onReplyAdd */}
            ))}
          </>
        )}
      </div>
    </div>
  );
}