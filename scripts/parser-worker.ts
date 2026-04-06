/**
 * Parser Worker — runs on Mac Mini alongside Docker odota/parser
 *
 * Polls Supabase for pending parse jobs, processes them locally,
 * and writes results back to Supabase.
 *
 * Usage:
 *   npx tsx scripts/parser-worker.ts
 *
 * Requires:
 *   - Docker running: docker run -p 5600:5600 odota/parser
 *   - Environment variables in .env.local
 */

import { createClient } from "@supabase/supabase-js";

// Load .env.local
import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const PARSER_URL = process.env.PARSER_URL || "http://localhost:5600";
const POLL_INTERVAL = 30_000; // 30 seconds

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface GlyphEvent {
  time: number;
  playerSlot: number;
  isRadiant: boolean | null;
  heroId: number | null;
}

interface MatchPlayer {
  hero_id: number;
  player_slot: number;
  isRadiant: boolean;
  glyphUses: number;
}

interface MatchData {
  replay_url: string | null;
  players: MatchPlayer[];
}

async function getMatchData(matchId: number): Promise<MatchData | null> {
  const res = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    replay_url: data.replay_url || null,
    players: (data.players || []).map((p: { hero_id: number; player_slot: number; isRadiant: boolean; actions?: Record<string, number> }) => ({
      hero_id: p.hero_id,
      player_slot: p.player_slot,
      isRadiant: p.isRadiant,
      glyphUses: p.actions?.["24"] ?? 0,
    })),
  };
}

async function parseReplay(replayUrl: string, players: MatchData["players"]): Promise<GlyphEvent[]> {
  // Parser glyph events have player1 = team number (2 = Radiant, 3 = Dire)
  // We need to attribute heroes using OpenDota's per-player glyph counts
  // Strategy: build a queue of heroes per team sorted by glyph count, assign chronologically
  // Download the replay file
  console.log("  Downloading replay...");
  const downloadRes = await fetch(replayUrl, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!downloadRes.ok) {
    throw new Error(`Failed to download replay: HTTP ${downloadRes.status}`);
  }
  const replayBuffer = Buffer.from(await downloadRes.arrayBuffer());
  console.log(`  Downloaded ${(replayBuffer.length / 1024 / 1024).toFixed(1)}MB`);

  // Decompress bz2 if needed
  let demBuffer: Buffer;
  if (replayUrl.endsWith(".bz2")) {
    console.log("  Decompressing bz2...");
    const { execSync } = await import("child_process");
    // Write to temp file, decompress, read back
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const tmpBz2 = path.join(os.tmpdir(), `replay_${Date.now()}.dem.bz2`);
    const tmpDem = tmpBz2.replace(".bz2", "");
    fs.writeFileSync(tmpBz2, replayBuffer);
    try {
      execSync(`bunzip2 -f "${tmpBz2}"`, { timeout: 60_000 });
      demBuffer = fs.readFileSync(tmpDem);
      fs.unlinkSync(tmpDem);
    } catch {
      // Try with bzip2 -d as fallback
      try {
        execSync(`bzip2 -d -f "${tmpBz2}"`, { timeout: 60_000 });
        demBuffer = fs.readFileSync(tmpDem);
        fs.unlinkSync(tmpDem);
      } catch {
        // Clean up
        try { fs.unlinkSync(tmpBz2); } catch {}
        try { fs.unlinkSync(tmpDem); } catch {}
        throw new Error("Failed to decompress replay (bunzip2/bzip2 not found)");
      }
    }
    console.log(`  Decompressed to ${(demBuffer.length / 1024 / 1024).toFixed(1)}MB`);
  } else {
    demBuffer = replayBuffer;
  }

  // Send raw .dem to parser POST / endpoint (returns NDJSON)
  console.log("  Sending to parser...");
  const res = await fetch(PARSER_URL, {
    method: "POST",
    body: new Uint8Array(demBuffer),
    headers: { "Content-Type": "application/octet-stream" },
    signal: AbortSignal.timeout(300_000),
  });

  if (res.status === 204) {
    throw new Error("Replay file is corrupted or unavailable");
  }
  if (res.status === 500) {
    throw new Error("Parser failed to process replay (invalid or corrupted replay file)");
  }
  if (!res.ok) {
    throw new Error(`Parser returned status ${res.status}`);
  }

  const text = await res.text();

  // Check if parser returned an error instead of NDJSON
  if (text.includes("given stream does not seem to contain a valid replay")) {
    throw new Error("Invalid replay file format");
  }
  if (text.length === 0) {
    throw new Error("Parser returned empty response");
  }

  // Collect raw glyph events with team info
  // Parser player1 field = team number: 2 = Radiant, 3 = Dire
  const rawGlyphs: { time: number; isRadiant: boolean }[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        event.type === "chat_message_glyph_used" ||
        event.type === "CHAT_MESSAGE_GLYPH_USED" ||
        event.type === 12
      ) {
        const team = event.player1 ?? event.value ?? -1;
        rawGlyphs.push({
          time: Math.round(event.time ?? 0),
          isRadiant: team === 2, // Dota 2: team 2 = Radiant, team 3 = Dire
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Attribute heroes using OpenDota per-player glyph counts
  // Same queue strategy as STRATZ route
  const radiantQueue: { heroId: number; playerSlot: number }[] = [];
  const direQueue: { heroId: number; playerSlot: number }[] = [];

  for (const p of players) {
    if (p.glyphUses <= 0) continue;
    if (p.isRadiant) {
      for (let i = 0; i < p.glyphUses; i++) {
        radiantQueue.push({ heroId: p.hero_id, playerSlot: p.player_slot });
      }
    } else {
      for (let i = 0; i < p.glyphUses; i++) {
        direQueue.push({ heroId: p.hero_id, playerSlot: p.player_slot });
      }
    }
  }

  let radiantIdx = 0;
  let direIdx = 0;

  const glyphEvents: GlyphEvent[] = rawGlyphs.map((g) => {
    let heroId: number | null = null;
    let playerSlot = -1;

    if (g.isRadiant && radiantIdx < radiantQueue.length) {
      heroId = radiantQueue[radiantIdx].heroId;
      playerSlot = radiantQueue[radiantIdx].playerSlot;
      radiantIdx++;
    } else if (!g.isRadiant && direIdx < direQueue.length) {
      heroId = direQueue[direIdx].heroId;
      playerSlot = direQueue[direIdx].playerSlot;
      direIdx++;
    }

    return {
      time: g.time,
      playerSlot,
      isRadiant: g.isRadiant,
      heroId,
    };
  });

  return glyphEvents;
}

async function processJob(matchId: number): Promise<void> {
  console.log(`[${new Date().toISOString()}] Processing match ${matchId}...`);

  // Mark as parsing
  await supabase
    .from("glyph_events")
    .update({ status: "parsing", updated_at: new Date().toISOString() })
    .eq("match_id", matchId);

  try {
    // Get match data (replay URL + player info)
    const matchData = await getMatchData(matchId);
    if (!matchData) {
      throw new Error("Match not found on OpenDota (invalid match ID?)");
    }
    if (matchData.players.length === 0) {
      throw new Error("Match has no player data (invalid or incomplete match)");
    }
    if (!matchData.replay_url) {
      throw new Error("No replay URL available (replay may have expired or match needs to be parsed on OpenDota first)");
    }

    // Check if anyone actually used glyph
    const totalGlyphs = matchData.players.reduce((sum, p) => sum + p.glyphUses, 0);
    if (totalGlyphs === 0) {
      console.log(`  No glyph usage detected in this match. Saving empty result.`);
      await supabase
        .from("glyph_events")
        .update({
          status: "completed",
          glyph_data: [],
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("match_id", matchId);
      console.log(`  Done! Match ${matchId} completed (no glyphs used).`);
      return;
    }

    console.log(`  Replay URL: ${matchData.replay_url}`);
    console.log(`  Players: ${matchData.players.length}`);
    console.log(`  Total glyph uses: ${totalGlyphs}`);
    console.log(`  Parsing... (this may take a few minutes)`);

    // Parse replay with player data for hero attribution
    const glyphEvents = await parseReplay(matchData.replay_url, matchData.players);

    console.log(`  Found ${glyphEvents.length} glyph events`);

    // Write results
    await supabase
      .from("glyph_events")
      .update({
        status: "completed",
        glyph_data: glyphEvents,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("match_id", matchId);

    console.log(`  Done! Match ${matchId} completed.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`  Failed: ${message}`);

    await supabase
      .from("glyph_events")
      .update({
        status: "failed",
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("match_id", matchId);
  }
}

async function pollForJobs(): Promise<void> {
  const { data: jobs, error } = await supabase
    .from("glyph_events")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Failed to poll Supabase:", error.message);
    return;
  }

  if (jobs && jobs.length > 0) {
    await processJob(jobs[0].match_id);
  }
}

// Main loop
console.log("=== Dota 2 Replay Parser Worker ===");
console.log(`Parser URL: ${PARSER_URL}`);
console.log(`Supabase: ${SUPABASE_URL}`);
console.log(`Polling every ${POLL_INTERVAL / 1000}s for pending jobs...`);
console.log("");

// Check parser is running
fetch(PARSER_URL)
  .then((res) => {
    if (res.ok) console.log("Parser is reachable. Ready to process jobs.\n");
    else console.warn("Parser responded with status", res.status, "\n");
  })
  .catch(() => {
    console.error(
      "WARNING: Parser is not reachable at",
      PARSER_URL,
      "\nMake sure to run: docker run -p 5600:5600 odota/parser\n"
    );
  });

// Poll immediately, then on interval
pollForJobs();
setInterval(pollForJobs, POLL_INTERVAL);
