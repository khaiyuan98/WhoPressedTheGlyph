import type { GlyphEvent, BuildingKill } from "./types";

// === Types ===

export type GlyphEffectivenessLabel =
  | "Effective"
  | "Possibly Effective"
  | "Questionable"
  | "Likely Wasted";

export interface GlyphAnalysis {
  glyphEvent: GlyphEvent;
  label: GlyphEffectivenessLabel;
  score: number; // -100 to +100
  confidence: number; // 0.0 to 1.0
  reason: string; // Human-readable
  tags: string[]; // Fun tags: "Panic Glyph", "Clutch Save", etc.
}

export interface TeamGlyphSummary {
  team: "radiant" | "dire";
  total: number;
  effective: number; // Effective + Possibly Effective
  questionable: number;
  wasted: number; // Likely Wasted
  effectivenessPercent: number; // 0-100
}

// === Constants ===

const GLYPH_DURATION = 5; // Glyph invulnerability lasts ~5 seconds
const EARLY_GAME_THRESHOLD = 480; // 8 minutes — base rarely under serious threat
const MID_GAME_THRESHOLD = 1200; // 20 minutes

// Analysis time windows (seconds)
const WINDOW_BEFORE = 30; // Look for building kills before glyph
const WINDOW_AFTER_EXPIRE = 15; // Look for kills after glyph expires (time+5 to time+20)
const WINDOW_WIDE = 90; // Broad context window for "any building activity"
const WINDOW_JUST_BEFORE = 10; // "Too late" detection — building died very recently
const WINDOW_COOLDOWN_RESET = 5; // Building fell right before glyph → CD was about to reset

// === Helpers ===

/** Get building value tier (higher = more valuable to protect) */
function getBuildingValue(building: string): number {
  const lower = building.toLowerCase();
  if (lower.includes("ancient")) return 5;
  if (lower.includes("melee rax")) return 4;
  if (lower.includes("range rax")) return 3;
  if (lower.includes("t3")) return 3;
  if (lower.includes("t2")) return 2;
  if (lower.includes("t1")) return 1;
  return 1;
}

/** Check if a building destruction resets glyph cooldown (T1/T2/T3/Melee Rax) */
function isResetBuilding(building: string): boolean {
  const lower = building.toLowerCase();
  return (
    lower.includes("t1") ||
    lower.includes("t2") ||
    lower.includes("t3") ||
    lower.includes("melee rax")
  );
}

/** Get highest-value building name from a list of kills */
function getHighestValueBuilding(kills: BuildingKill[]): string | null {
  if (kills.length === 0) return null;
  return kills.reduce((best, k) =>
    getBuildingValue(k.building) > getBuildingValue(best.building) ? k : best
  ).building;
}

/** Format seconds as m:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Get the defending team's building kills.
 * If a team uses glyph (isRadiant), they're defending their OWN buildings.
 * BuildingKill.team = which team LOST the building.
 */
function getDefendingTeamKills(
  isRadiant: boolean | null,
  buildingKills: BuildingKill[]
): BuildingKill[] {
  if (isRadiant === null) return buildingKills; // Can't determine — use all
  const defendingTeam = isRadiant ? "radiant" : "dire";
  return buildingKills.filter((k) => k.team === defendingTeam);
}

/**
 * Get the ENEMY team's building kills (buildings the glyphing team is destroying).
 * Used for offensive glyph detection.
 */
function getAttackingTeamKills(
  isRadiant: boolean | null,
  buildingKills: BuildingKill[]
): BuildingKill[] {
  if (isRadiant === null) return [];
  const attackingTeam = isRadiant ? "dire" : "radiant";
  return buildingKills.filter((k) => k.team === attackingTeam);
}

// === Main Analysis ===

export function analyzeGlyphEffectiveness(
  glyph: GlyphEvent,
  buildingKills: BuildingKill[],
  matchDuration: number
): GlyphAnalysis {
  const t = glyph.time;
  const teamKills = getDefendingTeamKills(glyph.isRadiant, buildingKills);

  // Gather building kills in various time windows
  const killsJustBefore = teamKills.filter(
    (k) => k.time >= t - WINDOW_JUST_BEFORE && k.time < t
  );
  const killsBefore = teamKills.filter(
    (k) => k.time >= t - WINDOW_BEFORE && k.time < t
  );
  const killsAfterExpiry = teamKills.filter(
    (k) =>
      k.time >= t + GLYPH_DURATION && k.time <= t + GLYPH_DURATION + WINDOW_AFTER_EXPIRE
  );
  const killsWideWindow = teamKills.filter(
    (k) => k.time >= t - WINDOW_WIDE && k.time <= t + WINDOW_WIDE
  );
  const resetBuildingBefore = killsJustBefore.some(
    (k) => k.time >= t - WINDOW_COOLDOWN_RESET && isResetBuilding(k.building)
  );

  // Tags
  const tags: string[] = [];

  // Check for panic glyph (used within 3s of a building dying)
  const panicKill = teamKills.find(
    (k) => k.time >= t - 3 && k.time <= t
  );
  if (panicKill) tags.push("Panic Glyph");

  // Check for grief glyph (before 5 min, nothing happening)
  if (t < 300 && killsWideWindow.length === 0) {
    tags.push("Grief Glyph");
  }

  // === Rule-based scoring (priority order) ===

  // Rule A: Early game waste
  if (t < EARLY_GAME_THRESHOLD && killsWideWindow.length === 0) {
    return {
      glyphEvent: glyph,
      label: "Likely Wasted",
      score: -60,
      confidence: 0.85,
      reason: `Used at ${formatTime(t)} with no buildings under threat — too early in the game`,
      tags,
    };
  }

  // Rule A2: Offensive glyph — team is pushing enemy base, not defending
  if (killsWideWindow.length === 0 && glyph.isRadiant !== null) {
    const enemyKills = getAttackingTeamKills(glyph.isRadiant, buildingKills);
    const enemyKillsNearby = enemyKills.filter(
      (k) => k.time >= t - WINDOW_BEFORE && k.time <= t + WINDOW_BEFORE
    );
    if (enemyKillsNearby.length > 0) {
      const nearestKill = enemyKillsNearby.reduce((closest, k) =>
        Math.abs(k.time - t) < Math.abs(closest.time - t) ? k : closest
      );
      tags.push("Offensive Glyph");
      return {
        glyphEvent: glyph,
        label: "Possibly Effective",
        score: 15,
        confidence: 0.5,
        reason: `Used while pushing — ${nearestKill.building} destroyed nearby`,
        tags,
      };
    }
  }

  // Rule B: No building activity at all within wide window
  if (killsWideWindow.length === 0) {
    return {
      glyphEvent: glyph,
      label: "Likely Wasted",
      score: -50,
      confidence: 0.7,
      reason: "No buildings were under attack within 90 seconds",
      tags,
    };
  }

  // Rule C: Too late — building died just before glyph, nothing saved after
  if (killsJustBefore.length > 0 && killsAfterExpiry.length === 0 && killsBefore.length <= killsJustBefore.length) {
    const lateBuilding = killsJustBefore[killsJustBefore.length - 1];
    const delay = Math.round(t - lateBuilding.time);

    // If the building that died would have reset glyph CD, it's less wasteful
    if (resetBuildingBefore) {
      tags.push("Free Glyph");
      return {
        glyphEvent: glyph,
        label: "Questionable",
        score: -15,
        confidence: 0.6,
        reason: `Used ${delay}s after ${lateBuilding.building} fell — but cooldown was reset anyway`,
        tags,
      };
    }

    return {
      glyphEvent: glyph,
      label: "Likely Wasted",
      score: -40,
      confidence: 0.7,
      reason: `Used ${delay}s after ${lateBuilding.building} already fell`,
      tags,
    };
  }

  // Rule D: CD reset waste — a reset building fell right before glyph
  if (resetBuildingBefore && killsAfterExpiry.length === 0) {
    const resetKill = killsJustBefore.find((k) => isResetBuilding(k.building));
    tags.push("Free Glyph");
    return {
      glyphEvent: glyph,
      label: "Questionable",
      score: -20,
      confidence: 0.65,
      reason: `${resetKill?.building ?? "Tower"} fell just before — glyph cooldown was about to reset`,
      tags,
    };
  }

  // Rule E: Delayed a kill — building dies shortly after glyph expires
  if (killsAfterExpiry.length > 0) {
    const delayedKill = killsAfterExpiry[0];
    const delay = Math.round(delayedKill.time - t);
    const buildingValue = getBuildingValue(delayedKill.building);
    const score = 40 + buildingValue * 8;

    // Check if a reset building died during glyph → free refresh
    const resetDuringGlyph = teamKills.find(
      (k) => k.time >= t && k.time < t + GLYPH_DURATION && isResetBuilding(k.building)
    );
    if (resetDuringGlyph) tags.push("Free Glyph");

    // High-value protection
    if (buildingValue >= 4) {
      tags.push("High Stakes");
    }

    return {
      glyphEvent: glyph,
      label: "Effective",
      score: Math.min(score, 100),
      confidence: 0.85,
      reason: `Delayed ${delayedKill.building} destruction by ~${delay}s`,
      tags,
    };
  }

  // Rule F: Stopped the push — buildings falling before glyph, nothing dies after
  if (killsBefore.length > 0 && killsAfterExpiry.length === 0) {
    const highestValue = getHighestValueBuilding(killsBefore);
    const isHighValue = highestValue ? getBuildingValue(highestValue) >= 3 : false;

    if (isHighValue) tags.push("Clutch Save");

    return {
      glyphEvent: glyph,
      label: "Effective",
      score: isHighValue ? 60 : 50,
      confidence: 0.7,
      reason: `Used during active push — no further buildings lost after glyph`,
      tags,
    };
  }

  // Rule G: Cluster defense — 2+ kills in wide window (intense push)
  if (killsWideWindow.length >= 2) {
    const highestValue = getHighestValueBuilding(killsWideWindow);
    const isHighValue = highestValue ? getBuildingValue(highestValue) >= 3 : false;

    if (isHighValue) tags.push("High Stakes");

    return {
      glyphEvent: glyph,
      label: "Effective",
      score: 30 + killsWideWindow.length * 10,
      confidence: 0.75,
      reason: `Used during intense push (${killsWideWindow.length} buildings fell nearby)`,
      tags,
    };
  }

  // Rule I: Fallback — some activity but no clear pattern
  return {
    glyphEvent: glyph,
    label: "Possibly Effective",
    score: 10,
    confidence: 0.4,
    reason: "Building activity nearby but outcome unclear",
    tags,
  };
}

/** Analyze all glyph events in a match */
export function analyzeAllGlyphs(
  glyphEvents: GlyphEvent[],
  buildingKills: BuildingKill[],
  matchDuration: number
): GlyphAnalysis[] {
  return glyphEvents.map((glyph) =>
    analyzeGlyphEffectiveness(glyph, buildingKills, matchDuration)
  );
}

/** Aggregate glyph analyses into per-team summaries */
export function getTeamSummaries(
  analyses: GlyphAnalysis[]
): { radiant: TeamGlyphSummary; dire: TeamGlyphSummary } {
  function buildSummary(team: "radiant" | "dire"): TeamGlyphSummary {
    const isTeam = team === "radiant";
    const teamAnalyses = analyses.filter((a) => a.glyphEvent.isRadiant === isTeam);
    const total = teamAnalyses.length;
    const effective = teamAnalyses.filter(
      (a) => a.label === "Effective" || a.label === "Possibly Effective"
    ).length;
    const questionable = teamAnalyses.filter(
      (a) => a.label === "Questionable"
    ).length;
    const wasted = teamAnalyses.filter(
      (a) => a.label === "Likely Wasted"
    ).length;
    return {
      team,
      total,
      effective,
      questionable,
      wasted,
      effectivenessPercent: total > 0 ? Math.round((effective / total) * 100) : 0,
    };
  }

  return { radiant: buildSummary("radiant"), dire: buildSummary("dire") };
}
