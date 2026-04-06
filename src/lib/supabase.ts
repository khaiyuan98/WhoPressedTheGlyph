import { createClient } from "@supabase/supabase-js";
import type { GlyphEvent } from "./types";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export interface GlyphJobRow {
  match_id: number;
  status: "pending" | "parsing" | "completed" | "failed";
  glyph_data: GlyphEvent[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Check if parsed glyph data already exists in Supabase */
export async function getCachedGlyphEvents(
  matchId: number
): Promise<GlyphJobRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("glyph_events")
    .select("*")
    .eq("match_id", matchId)
    .single();
  if (error || !data) return null;
  return data as GlyphJobRow;
}

/** Request a parse job — inserts a pending row if not exists */
export async function requestParse(matchId: number): Promise<GlyphJobRow | null> {
  if (!supabase) return null;

  // Check if already exists
  const existing = await getCachedGlyphEvents(matchId);
  if (existing) return existing;

  // Insert new pending job
  const { data, error } = await supabase
    .from("glyph_events")
    .insert({ match_id: matchId, status: "pending" })
    .select()
    .single();
  if (error || !data) return null;
  return data as GlyphJobRow;
}

/** Update job status and data */
export async function updateParseJob(
  matchId: number,
  status: GlyphJobRow["status"],
  glyphData?: GlyphEvent[],
  error?: string
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("glyph_events")
    .update({
      status,
      glyph_data: glyphData ?? null,
      error: error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("match_id", matchId);
}

/** Save glyph events to cache (upsert — works for new or existing rows) */
export async function saveGlyphEvents(
  matchId: number,
  glyphEvents: GlyphEvent[],
  source: string
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("glyph_events")
    .upsert(
      {
        match_id: matchId,
        status: "completed" as const,
        glyph_data: glyphEvents,
        error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "match_id" }
    );
}

/** Get pending jobs for the worker to pick up */
export async function getPendingJobs(): Promise<GlyphJobRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("glyph_events")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error || !data) return [];
  return data as GlyphJobRow[];
}
