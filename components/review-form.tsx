"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ReviewFormProps {
  animeId: string; // external anime ID as string
  onReviewSubmit?: () => void;
}

export default function ReviewForm({ animeId, onReviewSubmit }: ReviewFormProps) {
  const [title, setTitle] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Fetch user ID
  // We'll use an effect to get the user ID once
  // In practice, we could pass it as a prop, but we'll fetch here.
  // To avoid multiple fetches, we could use context, but for simplicity we'll fetch.
  // We'll use a lazy initialization via useRef or useEffect.
  // We'll do it in a separate effect.

  // We'll create a separate effect for user ID.
  // But we can also fetch it in the submit handler.

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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
      const { error } = await supabase
        .from("anime_reviews")
        .insert({
          user_id: user.id,
          anime_id: animeId,
          title: title.trim() || null,
          body: body.trim(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
      setTitle("");
      setBody("");
      if (onReviewSubmit) onReviewSubmit();
    } catch (err: any) {
      setError(err.message || "Failed to submit review");
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
          className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="review-body">Review Body</Label>
        <Textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your review..."
          className="w-full p-2 rounded border border-gray-600 bg-[#101827/80] text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#7047F5]"
          rows={4}
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Submitting..." : "Publish Review"}
      </button>
    </form>
  );
}