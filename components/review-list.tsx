"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ReviewCard from "./review-card";
import { cn } from "@/lib/utils";

interface ReviewListProps {
  animeId: string; // external anime ID as string
}

export default function ReviewList({ animeId }: ReviewListProps) {
  const [reviews, setReviews] = useState<Array<any>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        // Fetch reviews with profile data (username, avatar_url) via left join
        const { data, error } = await supabase
          .from("anime_reviews")
          .select(`
            id,
            user_id,
            anime_id,
            title,
            body,
            created_at,
            updated_at,
            profiles (
              username,
              avatar_url
            )
          `)
          .eq("anime_id", animeId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setReviews(data);
      } catch (err: any) {
        setError(err.message || "Failed to load reviews");
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, [animeId]);

  if (loading) {
    return <div className="flex h-[60vh] items-center justify-center">Loading...</div>;
  }

  if (error) {
    return <div className="flex h-[60vh] items-center justify-center">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {reviews.length === 0 ? (
        <p className="text-center text-gray-400">No reviews yet. Be the first to write one!</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}