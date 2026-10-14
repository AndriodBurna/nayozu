"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RatingProps {
  animeId: string; // external anime ID as string
  onRatingChange?: (rating: number) => void;
}

export default function Rating({ animeId, onRatingChange }: RatingProps) {
  const [userRating, setUserRating] = useState<number | null>(null);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch user ID and ratings data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUserId(user ? user.id : null);

        if (user) {
          // Fetch user's rating for this anime
          const { data: userRatingData, error: userRatingError } = await supabase
            .from("anime_ratings")
            .select("rating")
            .eq("user_id", user.id)
            .eq("anime_id", animeId)
            .single();

          if (userRatingError && userRatingError.code !== "PGRST116") {
            throw userRatingError;
          }
          setUserRating(userRatingData?.rating ?? null);

          // Fetch aggregate rating and count
          const { data: aggregateData, error: aggregateError } = await supabase
            .from("anime_ratings")
            .select("rating", { count: "exact" })
            .eq("animeId", animeId);

          if (aggregateError) throw aggregateError;

          const ratings = aggregateData.map((r: any) => r.rating);
          const count = ratings.length;
          const sum = ratings.reduce((acc: number, val: number) => acc + val, 0);
          const avg = count > 0 ? sum / count : null;

          setRatingCount(count);
          setAverageRating(avg);
        } else {
          setUserId(null);
          setUserRating(null);
          setAverageRating(null);
          setRatingCount(0);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load rating data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [animeId]);

  const handleRatingSubmit = async (rating: number) => {
    if (!userId) {
      alert("Please log in to rate anime");
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      // Upsert: insert or update based on unique constraint
      const { error } = await supabase
        .from("anime_ratings")
        .upsert(
          {
            user_id: userId,
            anime_id: animeId,
            rating: rating,
            updated_at: new Date().toISOString(),
          },
          { onConflict: ["user_id", "anime_id"] }
        );

      if (error) throw error;

      setUserRating(rating);
      // Recalculate aggregate (optimistic update)
      setRatingCount((prev) => (ratingCount === 0 ? 1 : prev + 1));
      if (averageRating === null) {
        setAverageRating(rating);
      } else {
        const newSum = averageRating * ratingCount + rating;
        const newCount = ratingCount + 1;
        setAverageRating(newSum / newCount);
      }

      if (onRatingChange) {
        onRatingChange(rating);
      }
    } catch (err: any) {
      setError(err.message || "Failed to submit rating");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRatingRemove = async () => {
    if (!userId) return;
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("anime_ratings")
        .delete()
        .eq("user_id", userId)
        .eq("anime_id", animeId);

      if (error) throw error;

      setUserRating(null);
      // Recalculate aggregate (optimistic update)
      if (ratingCount > 0) {
        if (averageRating !== null) {
          const newSum = averageRating * ratingCount - (userRating ?? 0);
          const newCount = ratingCount - 1;
          setRatingCount(newCount);
          setAverageRating(newCount > 0 ? newSum / newCount : null);
        } else {
          setRatingCount(ratingCount - 1);
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to remove rating");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center space-x-2">Loading...</div>;
  }

  if (error) {
    return <div className="flex items-center space-x-2 text-red-500">{error}</div>;
  }

  return (
    <div className="flex flex-col items-center space-x-2 text-center">
      <div className="flex items-center space-x-2">
        {averageRating !== null ? (
          <span className="text-2xl font-bold text-white">
            {averageRating.toFixed(1)}
          </span>
        ) : (
          <span className="text-xl font-bold text-gray-400">—</span>
        )}
        <span className="text-sm text-gray-400">/10</span>
        {ratingCount > 0 && (
          <span className="ml-2 text-sm text-gray-400">
            ({ratingCount} ratings)
          </span>
        )}
      </div>

      {!userId ? (
        <button
          onClick={() => {
            // Redirect to login
            window.location.href = "/auth/login";
          }}
          className="text-sm text-[#7047F5] hover:underline"
        >
          Sign in to rate
        </button>
      ) : userRating !== null ? (
        <div className="flex space-x-2 mt-2">
          <button
            onClick={() => handleRatingRemove()}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Remove Rating
          </button>
          <div className="flex space-x-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
              <button
                key={r}
                onClick={() => handleRatingSubmit(r)}
                disabled={isSubmitting}
                className={cn(
                  "w-6 h-6 rounded border border-gray-600 hover:bg-gray-800",
                  userRating === r ? "bg-[#7047F5]" : "bg-transparent"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex space-x-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
            <button
              key={r}
              onClick={() => handleRatingSubmit(r)}
              disabled={isSubmitting}
              className={cn(
                "w-6 h-6 rounded border border-gray-600 hover:bg-gray-800",
                "hover:text-white"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}