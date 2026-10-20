import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const mediaType = typeParam === "manga" ? "manga" : "anime";

  const supabase = await createClient();

  // Count total titles of that media_type
  const { count, error: countError } = await supabase
    .from("anime")
    .select("*", { count: "exact", head: true })
    .eq("media_type", mediaType);

  if (countError || !count || count <= 0) {
    return NextResponse.redirect(new URL(`/${mediaType}`, request.url), 307);
  }

  // Pick a random offset between 0 and count - 1
  const randomOffset = Math.floor(Math.random() * count);

  // Fetch one row ordered by id so the offset is deterministic
  const { data, error } = await supabase
    .from("anime")
    .select("slug")
    .eq("media_type", mediaType)
    .order("id")
    .range(randomOffset, randomOffset)
    .maybeSingle();

  if (error || !data?.slug) {
    // If offset lookup failed, fallback to the first row of that media_type
    const { data: fallback } = await supabase
      .from("anime")
      .select("slug")
      .eq("media_type", mediaType)
      .order("id")
      .limit(1)
      .maybeSingle();

    if (fallback?.slug) {
      return NextResponse.redirect(
        new URL(`/${mediaType}/${fallback.slug}`, request.url),
        307
      );
    }
    return NextResponse.redirect(new URL(`/${mediaType}`, request.url), 307);
  }

  return NextResponse.redirect(
    new URL(`/${mediaType}/${data.slug}`, request.url),
    307
  );
}
