import { NextResponse } from "next/server";
import { getMatch, getHeroes, transformMatchData } from "@/lib/opendota";

export async function GET(
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
    const [match, heroes] = await Promise.all([getMatch(id), getHeroes()]);
    const result = transformMatchData(match);

    return NextResponse.json({ match: result, heroes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
