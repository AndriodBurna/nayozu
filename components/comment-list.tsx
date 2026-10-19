"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Comment from "./comment";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CommentListProps {
  animeId: string; // external anime ID as string
}

interface CommentRow {
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
}

interface CommentWithReplies extends CommentRow {
  replies: CommentWithReplies[];
}

// Used for both the list and for a freshly inserted comment, so a new
// comment always carries its author (profiles) and renders correctly.
const COMMENT_SELECT = `
  id, user_id, anime_id, parent_comment_id, body, is_spoiler, is_hidden,
  created_at, updated_at,
  profiles ( username, avatar_url )
`;

const byCreatedAt = (a: CommentRow, b: CommentRow) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

export default function CommentList({ animeId }: CommentListProps) {
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  useEffect(() => {
    const fetchComments = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const supabase = createClient();
        const { data, error } = await supabase
          .from("anime_comments")
          .select(COMMENT_SELECT)
          .eq("anime_id", animeId)
          .order("created_at", { ascending: true });
        if (error) throw error;

        const rows = (data ?? []) as unknown as CommentRow[];
        const map = new Map<string, CommentWithReplies>();
        rows.forEach((row) => map.set(row.id, { ...row, replies: [] }));

        const roots: CommentWithReplies[] = [];
        rows.forEach((row) => {
          const node = map.get(row.id);
          if (!node) return;
          const parent = row.parent_comment_id ? map.get(row.parent_comment_id) : undefined;
          if (parent) parent.replies.push(node);
          else if (!row.parent_comment_id) roots.push(node);
        });

        roots.sort(byCreatedAt);
        roots.forEach((c) => c.replies.sort(byCreatedAt));
        setComments(roots);
      } catch (err) {
        setLoadError((err as { message?: string }).message || "Failed to load comments");
      } finally {
        setLoading(false);
      }
    };

    fetchComments();
  }, [animeId]);

  const handleTopLevelSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You need to sign in to comment.");

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("anime_comments")
        .insert({
          user_id: user.id,
          anime_id: animeId,
          parent_comment_id: null,
          body: body.trim(),
          is_spoiler: false,
          is_hidden: false,
          created_at: now,
          updated_at: now,
        })
        .select(COMMENT_SELECT)
        .single();
      if (error) throw error;

      setBody("");
      setComments((prev) => [...prev, { ...(data as unknown as CommentRow), replies: [] }]);
    } catch (err) {
      setFormError((err as { message?: string }).message || "Failed to submit comment");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading comments...</div>;
  }
  if (loadError) {
    return <div className="py-10 text-center text-destructive">{loadError}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 font-semibold">Add a comment</h3>
        <form onSubmit={handleTopLevelSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="top-level-comment-body">Comment</Label>
            <Textarea
              id="top-level-comment-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
            />
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" size="sm" disabled={posting}>
            {posting ? "Posting..." : "Post Comment"}
          </Button>
        </form>
      </div>

      <div className="space-y-4">
        {comments.length === 0 ? (
          <p className="text-center text-muted-foreground">
            No comments yet. Be the first to comment!
          </p>
        ) : (
          comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              onReplyAdd={(parentId: string, newComment: CommentRow) => {
                setComments((prev) =>
                  prev.map((c) =>
                    c.id === parentId
                      ? { ...c, replies: [...c.replies, { ...newComment, replies: [] }] }
                      : c,
                  ),
                );
              }}
              onCommentUpdate={(commentId: string, updates: Partial<CommentRow>) => {
                setComments((prev) =>
                  prev.map((c) => {
                    if (c.id === commentId) return { ...c, ...updates };
                    if (c.replies.some((r) => r.id === commentId)) {
                      return {
                        ...c,
                        replies: c.replies.map((r) =>
                          r.id === commentId ? { ...r, ...updates } : r,
                        ),
                      };
                    }
                    return c;
                  }),
                );
              }}
              onCommentDelete={(commentId: string) => {
                setComments((prev) =>
                  prev
                    .filter((c) => c.id !== commentId)
                    .map((c) => ({
                      ...c,
                      replies: c.replies.filter((r) => r.id !== commentId),
                    })),
                );
              }}
              onCommentReport={(commentId: string) => {
                // Placeholder until the moderation flow is wired up.
                alert(`Report submitted for comment ${commentId}`);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}