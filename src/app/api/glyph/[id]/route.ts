import { NextResponse } from "next/server";
import { fetchStratzGlyphEvents } from "@/lib/stratz";
import { getCachedGlyphEvents, requestParse, saveGlyphEvents } from "@/lib/supabase";

/**
 * Unified glyph endpoint:
 * 1. Check Supabase cache first (instant if previously fetched)
 * 2. Try STRATZ (save to cache on success)
 * 3. If pending/parsing parser job exists, return status for polling
 * 4. Create a new pending parse job for Mac Mini worker
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid match ID." }, { status: 400 });
  }

  const matchId = Number(id);

  // 1. Check Supabase cache first (fastest path)
  const cached = await getCachedGlyphEvents(matchId);

  if (cached) {
    if (cached.status === "completed" && cached.glyph_data) {
      return NextResponse.json({
        glyphEvents: cached.glyph_data,
        source: "cache",
        status: "completed",
      });
    }
    if (cached.status === "pending" || cached.status === "parsing") {
      return NextResponse.json({
        glyphEvents: [],
        source: "parser",
        status: cached.status,
      });
    }
    // If failed, continue to try STRATZ (data may be available now)
  }

  // 2. Try STRATZ
  try {
    const result = await fetchStratzGlyphEvents(id);
    if (result.glyphEvents.length > 0) {
      // Save to Supabase cache for future requests
      await saveGlyphEvents(matchId, result.glyphEvents, "stratz");

      return NextResponse.json({
        glyphEvents: result.glyphEvents,
        source: "stratz",
        status: "completed",
      });
    }
  } catch {
    // STRATZ failed, continue to fallback
  }

  // 3. No cache and no STRATZ data — create a pending parse job
  const job = await requestParse(matchId);

  if (job) {
    return NextResponse.json({
      glyphEvents: [],
      source: "parser",
      status: job.status,
    });
  }

  // 4. Supabase not configured — return empty
  return NextResponse.json({
    glyphEvents: [],
    source: "none",
    status: "completed",
    error: "No glyph timestamp data available.",
  });
}
