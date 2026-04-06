import { getMatch } from "@/lib/opendota";
import type { GlyphEvent } from "@/lib/types";

const STRATZ_API_URL = "https://api.stratz.com/graphql";
const STRATZ_TOKEN = process.env.STRATZ_API_KEY || "";

const GLYPH_CHAT_TYPE = 12;

const MATCH_QUERY = `
  query GetMatchGlyphData($matchId: Long!) {
    match(id: $matchId) {
      id
      chatEvents {
        time
        type
        isRadiant
        fromHeroId
        value
      }
      players {
        heroId
        isRadiant
        playerSlot
      }
    }
  }
`;

interface StratzChatEvent {
  time: number;
  type: number;
  isRadiant: boolean | null;
  fromHeroId: number | null;
  value: number;
}

interface StratzPlayer {
  heroId: number;
  isRadiant: boolean;
  playerSlot: number;
}

export interface StratzGlyphResult {
  glyphEvents: GlyphEvent[];
  error?: string;
}

/**
 * Fetch glyph events from STRATZ API with hero attribution from OpenDota.
 * Returns glyph events array (empty if no data), or throws on hard errors.
 */
export async function fetchStratzGlyphEvents(matchId: string): Promise<StratzGlyphResult> {
  if (!STRATZ_TOKEN) {
    return { glyphEvents: [], error: "STRATZ API key not configured." };
  }

  const res = await fetch(STRATZ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STRATZ_TOKEN}`,
      "User-Agent": "WhoPressedTheGlyph/1.0",
    },
    body: JSON.stringify({
      query: MATCH_QUERY,
      variables: { matchId: Number(matchId) },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (text.includes("Just a moment") || text.includes("challenge")) {
      return { glyphEvents: [], error: "STRATZ API temporarily unavailable (Cloudflare challenge)." };
    }
    return { glyphEvents: [], error: `STRATZ API returned status ${res.status}` };
  }

  const data = await res.json();

  if (data.errors) {
    return { glyphEvents: [], error: data.errors[0]?.message || "STRATZ GraphQL error" };
  }

  const match = data.data?.match;
  if (!match) {
    return { glyphEvents: [], error: "Match not found on STRATZ." };
  }

  // Get OpenDota data for per-player glyph counts (to attribute hero)
  let playerGlyphCounts: Record<
    number,
    { heroId: number; glyphUses: number; isRadiant: boolean }
  > = {};
  try {
    const odMatch = await getMatch(matchId);
    for (const p of odMatch.players) {
      const glyphUses = p.actions?.["24"] ?? 0;
      if (glyphUses > 0) {
        playerGlyphCounts[p.hero_id] = {
          heroId: p.hero_id,
          glyphUses,
          isRadiant: p.isRadiant,
        };
      }
    }
  } catch {
    // OpenDota not available, proceed without hero attribution
  }

  const stratzPlayers: StratzPlayer[] = match.players || [];
  const chatEvents: StratzChatEvent[] = match.chatEvents || [];

  const rawGlyphs = chatEvents.filter((e) => e.type === GLYPH_CHAT_TYPE);

  // Build assignment queues per team
  const radiantGlyphers = Object.values(playerGlyphCounts)
    .filter((p) => p.isRadiant)
    .sort((a, b) => b.glyphUses - a.glyphUses);
  const direGlyphers = Object.values(playerGlyphCounts)
    .filter((p) => !p.isRadiant)
    .sort((a, b) => b.glyphUses - a.glyphUses);

  const radiantQueue: number[] = [];
  for (const p of radiantGlyphers) {
    for (let i = 0; i < p.glyphUses; i++) radiantQueue.push(p.heroId);
  }
  const direQueue: number[] = [];
  for (const p of direGlyphers) {
    for (let i = 0; i < p.glyphUses; i++) direQueue.push(p.heroId);
  }

  let radiantIdx = 0;
  let direIdx = 0;

  const glyphEvents: GlyphEvent[] = rawGlyphs.map((e) => {
    const isRadiant = e.isRadiant ?? null;
    let heroId: number | null = null;

    if (isRadiant === true && radiantIdx < radiantQueue.length) {
      heroId = radiantQueue[radiantIdx++];
    } else if (isRadiant === false && direIdx < direQueue.length) {
      heroId = direQueue[direIdx++];
    }

    let playerSlot = -1;
    if (heroId) {
      const sp = stratzPlayers.find((p) => p.heroId === heroId);
      if (sp) playerSlot = sp.playerSlot;
    }

    return { time: e.time, playerSlot, isRadiant, heroId };
  });

  return { glyphEvents };
}
