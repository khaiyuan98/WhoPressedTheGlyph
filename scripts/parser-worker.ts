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
  version: number | null;
  players: MatchPlayer[];
}

async function getMatchData(matchId: number): Promise<MatchData | null> {
  const res = await fetch(`https://api.opendota.com/api/matches/${matchId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    replay_url: data.replay_url || null,
    version: data.version ?? null,
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
  // Sometimes player1 is 0 for Radiant and 1 for Dire in some parser versions or game modes
  const rawGlyphs: { time: number; teamId: number }[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        event.type === "chat_message_glyph_used" ||
        event.type === "CHAT_MESSAGE_GLYPH_USED" ||
        event.type === 12
      ) {
        const teamId = event.player1 ?? event.value ?? -1;
        rawGlyphs.push({
          time: Math.round(event.time ?? 0),
          teamId: teamId,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  console.log(`  Raw glyph events found by parser: ${rawGlyphs.length}`);
  for (const g of rawGlyphs) {
    console.log(`    Time: ${g.time}, Team ID: ${g.teamId}`);
  }

  // Attribute heroes using OpenDota per-player glyph counts
  // Same queue strategy as STRATZ route but with better team mapping
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

  // Heuristic for team IDs:
  // If we see 2 and 3, they are Radiant and Dire.
  // If we see 0 and 1, they are Radiant and Dire.
  const uniqueTeamIds = Array.from(new Set(rawGlyphs.map(g => g.teamId))).sort();
  console.log(`  Unique team IDs found in parser: ${uniqueTeamIds.join(", ")}`);

  let radiantIdx = 0;
  let direIdx = 0;

  const glyphEvents: GlyphEvent[] = rawGlyphs.map((g) => {
    let isRadiant = false;
    
    // Default mapping: 2 = Radiant, 3 = Dire
    // Fallback mapping: 0 = Radiant, 1 = Dire (some parser versions)
    if (g.teamId === 2 || g.teamId === 0) {
      isRadiant = true;
    } else if (g.teamId === 3 || g.teamId === 1) {
      isRadiant = false;
    } else {
      // If we only have one team's glyphs and the ID is weird, 
      // check which team has glyphs left in the queue.
      if (radiantQueue.length > 0 && direQueue.length === 0) isRadiant = true;
      else if (direQueue.length > 0 && radiantQueue.length === 0) isRadiant = false;
      else {
        // Last resort: assume Radiant if ID is even, Dire if odd (common in some formats)
        isRadiant = g.teamId % 2 === 0;
      }
    }

    let heroId: number | null = null;
    let playerSlot = -1;

    if (isRadiant && radiantIdx < radiantQueue.length) {
      heroId = radiantQueue[radiantIdx].heroId;
      playerSlot = radiantQueue[radiantIdx].playerSlot;
      radiantIdx++;
    } else if (!isRadiant && direIdx < direQueue.length) {
      heroId = direQueue[direIdx].heroId;
      playerSlot = direQueue[direIdx].playerSlot;
      direIdx++;
    } else if (isRadiant && direIdx < direQueue.length && radiantIdx >= radiantQueue.length) {
       // Team mismatch: if we think it's Radiant but Radiant queue is empty, try Dire
       heroId = direQueue[direIdx].heroId;
       playerSlot = direQueue[direIdx].playerSlot;
       isRadiant = false;
       direIdx++;
    } else if (!isRadiant && radiantIdx < radiantQueue.length && direIdx >= direQueue.length) {
       // Team mismatch: if we think it's Dire but Dire queue is empty, try Radiant
       heroId = radiantQueue[radiantIdx].heroId;
       playerSlot = radiantQueue[radiantIdx].playerSlot;
       isRadiant = true;
       radiantIdx++;
    }

    return {
      time: g.time,
      playerSlot,
      isRadiant,
      heroId,
    };
  });

  return glyphEvents;
}

async function processJob(matchId: number): Promise<void> {
  console.log(`[${new Date().toISOString()}] Processing match ${matchId}...`);

  // Check if this match already has valid glyph data (e.g., from STRATZ)
  const { data: existing } = await supabase
    .from("glyph_events")
    .select("glyph_data")
    .eq("match_id", matchId)
    .single();

  if (existing?.glyph_data && Array.isArray(existing.glyph_data) && existing.glyph_data.length > 0) {
    console.log(`  Match already has ${existing.glyph_data.length} glyph events from cache. Marking as completed.`);
    await supabase
      .from("glyph_events")
      .update({ status: "completed", error: null, updated_at: new Date().toISOString() })
      .eq("match_id", matchId);
    return;
  }

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

    // Check if OpenDota has finished parsing (version !== null means parsed)
    const totalGlyphs = matchData.players.reduce((sum, p) => sum + p.glyphUses, 0);
    const isParsed = matchData.version !== null && matchData.version !== undefined;

    if (!isParsed) {
      // OpenDota hasn't parsed this match yet — glyph counts are unreliable
      // Mark as failed so it can be retried later
      throw new Error("Match not yet parsed by OpenDota. Retry after parsing completes.");
    }

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

    // If parser found 0 events but OpenDota says there are glyphs, something is wrong
    // Mark as failed so it can be retried
    if (glyphEvents.length === 0 && totalGlyphs > 0) {
      throw new Error(`Parser found 0 glyph events but OpenDota reports ${totalGlyphs} glyph uses. Replay may not be fully available yet.`);
    }

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
