import { NextResponse } from "next/server";
import { requestParse } from "@/lib/opendota";
import { supabase } from "@/lib/supabase";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "Invalid match ID. Must be a number." },
      { status: 400 }
    );
  }

  try {
    const result = await requestParse(id);

    // Track parse request in Supabase so we can disable the button on refresh
    if (supabase) {
      await supabase
        .from("glyph_events")
        .upsert(
          {
            match_id: Number(id),
            status: "parse_requested",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "match_id" }
        );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
