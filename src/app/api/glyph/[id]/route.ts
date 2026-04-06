import { NextResponse } from "next/server";
import { fetchStratzGlyphEvents } from "@/lib/stratz";
import { getCachedGlyphEvents, requestParse, saveGlyphEvents } from "@/lib/supabase";
import { getMatch } from "@/lib/opendota";

/**
 * Unified glyph endpoint:
 * 1. Check Supabase cache first (instant if previously fetched)
 * 2. Try STRATZ (save to cache on success, only if hero attribution succeeded)
 * 3. If pending/parsing parser job exists, return status for polling
 * 4. Check replay URL exists before creating parse job
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
    if (cached.status === "completed" && cached.glyph_data && cached.glyph_data.length > 0) {
      // Only serve from cache if there are actual glyph events
      return NextResponse.json({
        glyphEvents: cached.glyph_data,
        source: "cache",
        status: "completed",
      });
    }
    if (cached.status === "pending" || cached.status === "parsing" || cached.status === "parse_requested") {
      return NextResponse.json({
        glyphEvents: [],
        source: "parser",
        status: cached.status,
      });
    }
    // If failed or completed with empty data, continue to try STRATZ (data may be available now)
  }

  // 2. Try STRATZ
  try {
    const result = await fetchStratzGlyphEvents(id);
    if (result.glyphEvents.length > 0) {
      // Only cache if hero attribution succeeded (at least one event has heroId)
      const hasHeroAttribution = result.glyphEvents.some((e) => e.heroId !== null);

      if (hasHeroAttribution) {
        await saveGlyphEvents(matchId, result.glyphEvents, "stratz");
      }

      return NextResponse.json({
        glyphEvents: result.glyphEvents,
        source: "stratz",
        status: "completed",
      });
    }
  } catch {
    // STRATZ failed, continue to fallback
  }

  // 3. No cache and no STRATZ data — check if replay exists before creating parse job
  try {
    const match = await getMatch(id);
    if (!match.replay_url) {
      return NextResponse.json({
        glyphEvents: [],
        source: "none",
        status: "no_replay",
        error: "No replay available. Click 'Request Parse' to parse the match on OpenDota first, then refresh.",
      });
    }
  } catch {
    return NextResponse.json({
      glyphEvents: [],
      source: "none",
      status: "error",
      error: "Could not check replay availability.",
    });
  }

  // 4. Replay exists — create a pending parse job
  const job = await requestParse(matchId);

  if (job) {
    return NextResponse.json({
      glyphEvents: [],
      source: "parser",
      status: job.status,
    });
  }

  // 5. Supabase not configured — return empty
  return NextResponse.json({
    glyphEvents: [],
    source: "none",
    status: "completed",
    error: "No glyph timestamp data available.",
  });
}
