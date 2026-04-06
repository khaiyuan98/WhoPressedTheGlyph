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
    if (cached.status === "pending" || cached.status === "parsing") {
      return NextResponse.json({
        glyphEvents: [],
        source: "parser",
        status: cached.status,
      });
    }
    if (cached.status === "parse_requested") {
      // Continue to check STRATZ and OpenDota to see if it can transition to pending
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

  // 3. No cache and no STRATZ data — check if match is parsed and replay exists
  let matchData;
  try {
    matchData = await getMatch(id);
  } catch {
    return NextResponse.json({
      glyphEvents: [],
      source: "none",
      status: "error",
      error: "Could not fetch match data from OpenDota.",
    });
  }

  const isParsed = matchData.version !== null && matchData.version !== undefined;

  if (!isParsed || !matchData.replay_url) {
    const status = cached?.status === "parse_requested" ? "parse_requested" : "no_replay";
    return NextResponse.json({
      glyphEvents: [],
      source: "none",
      status: status,
      error: !isParsed
        ? "Match not yet parsed by OpenDota. Click 'Request Parse' and wait a few minutes, then refresh."
        : "No replay available. Click 'Request Parse' to parse the match on OpenDota first, then refresh.",
    });
  }

  // Check if anyone actually used glyph (avoid unnecessary parser jobs)
  const totalGlyphs = matchData.players.reduce(
    (sum: number, p: { actions?: Record<string, number> }) => sum + (p.actions?.["24"] ?? 0),
    0
  );
  if (totalGlyphs === 0) {
    return NextResponse.json({
      glyphEvents: [],
      source: "opendota",
      status: "completed",
      error: "No glyph usage detected in this match.",
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
