import { NextResponse } from "next/server";
import { fetchStratzGlyphEvents } from "@/lib/stratz";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid match ID." }, { status: 400 });
  }

  try {
    const result = await fetchStratzGlyphEvents(id);

    if (result.error && result.glyphEvents.length === 0) {
      return NextResponse.json(
        { error: result.error },
        { status: 502 }
      );
    }

    return NextResponse.json({
      glyphEvents: result.glyphEvents,
      source: "stratz",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from STRATZ: ${message}` },
      { status: 502 }
    );
  }
}
