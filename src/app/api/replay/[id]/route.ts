import { NextResponse } from "next/server";
import { getMatch } from "@/lib/opendota";
import type { GlyphEvent } from "@/lib/types";

const PARSER_URL = process.env.PARSER_URL || "http://localhost:5600";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "Invalid match ID." },
      { status: 400 }
    );
  }

  // 1. Get replay URL from OpenDota
  let replayUrl: string | null;
  try {
    const match = await getMatch(id);
    replayUrl = match.replay_url;
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch match data from OpenDota." },
      { status: 502 }
    );
  }

  if (!replayUrl) {
    return NextResponse.json(
      {
        error:
          "No replay URL available. The replay may have expired (replays are only available for ~2 weeks).",
      },
      { status: 404 }
    );
  }

  // 2. Send replay to odota/parser
  let parserResponse: Response;
  try {
    const encodedUrl = encodeURIComponent(replayUrl);
    parserResponse = await fetch(
      `${PARSER_URL}/blob?replay_url=${encodedUrl}`,
      { signal: AbortSignal.timeout(120000) } // 2 minute timeout for large replays
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("fetch failed") || message.includes("ECONNREFUSED")) {
      return NextResponse.json(
        {
          error:
            "Replay parser is not running. Start it with: docker run -p 5600:5600 odota/parser",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: `Parser error: ${message}` },
      { status: 502 }
    );
  }

  if (parserResponse.status === 204) {
    return NextResponse.json(
      { error: "Replay file is corrupted or unavailable." },
      { status: 422 }
    );
  }

  if (!parserResponse.ok) {
    return NextResponse.json(
      { error: `Parser returned status ${parserResponse.status}` },
      { status: 502 }
    );
  }

  // 3. Parse NDJSON response and filter for glyph events
  const text = await parserResponse.text();
  const glyphEvents: GlyphEvent[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      // Look for glyph events - the type field may vary in format
      if (
        event.type === "chat_message_glyph_used" ||
        event.type === "CHAT_MESSAGE_GLYPH_USED" ||
        event.type === 12
      ) {
        glyphEvents.push({
          time: Math.round(event.time ?? 0),
          playerSlot: event.player1 ?? event.playerid_1 ?? event.slot ?? -1,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return NextResponse.json({ glyphEvents });
}
