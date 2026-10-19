"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ReviewFormProps {
  animeId: string; // external anime ID as string
  onReviewSubmit?: () => void;
}

export default function ReviewForm({ animeId, onReviewSubmit }: ReviewFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You need to sign in to write a review.");

      const now = new Date().toISOString();
      const { error } = await supabase.from("anime_reviews").insert({
        user_id: user.id,
        anime_id: animeId,
        title: title.trim() || null,
        body: body.trim(),
        created_at: now,
        updated_at: now,
      });
      if (error) throw error;

      setTitle("");
      setBody("");
      onReviewSubmit?.();
    } catch (err) {
      setError((err as { message?: string }).message || "Failed to submit review");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="review-title">Review Title (optional)</Label>
        <Input
          id="review-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave blank for no title"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="review-body">Review Body</Label>
        <Textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your review..."
          rows={4}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Submitting..." : "Publish Review"}
      </Button>
    </form>
  );
}