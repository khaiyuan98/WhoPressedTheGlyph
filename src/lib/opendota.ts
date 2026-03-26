import type {
  OpenDotaMatch,
  ParseRequestResponse,
  MatchGlyphResult,
  BuildingKill,
  HeroData,
} from "./types";

const OPENDOTA_BASE = "https://api.opendota.com/api";

export async function getMatch(matchId: string): Promise<OpenDotaMatch> {
  const res = await fetch(`${OPENDOTA_BASE}/matches/${matchId}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Match not found. Please check the match ID.");
    }
    throw new Error(`OpenDota API error: ${res.status}`);
  }
  return res.json();
}

export async function requestParse(
  matchId: string
): Promise<ParseRequestResponse> {
  const res = await fetch(`${OPENDOTA_BASE}/request/${matchId}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to request parse: ${res.status}`);
  }
  return res.json();
}

export async function getHeroes(): Promise<Record<number, HeroData>> {
  const res = await fetch(`${OPENDOTA_BASE}/heroes`);
  if (!res.ok) {
    throw new Error(`Failed to fetch heroes: ${res.status}`);
  }
  const heroes: HeroData[] = await res.json();
  const map: Record<number, HeroData> = {};
  for (const hero of heroes) {
    map[hero.id] = hero;
  }
  return map;
}

export function transformMatchData(match: OpenDotaMatch): MatchGlyphResult {
  const isParsed = match.version !== null && match.version !== undefined;

  const players = match.players.map((p) => ({
    accountId: p.account_id,
    playerSlot: p.player_slot,
    heroId: p.hero_id,
    personaname: p.personaname,
    // DOTA_UNIT_ORDER_GLYPH = 24 in the protobuf enum; OpenDota uses numeric keys
    glyphUses: p.actions?.["24"] ?? 0,
    isRadiant: p.isRadiant,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
  }));

  const buildingKills = extractBuildingKills(match);

  return {
    matchId: match.match_id,
    duration: match.duration,
    radiantWin: match.radiant_win,
    radiantScore: match.radiant_score,
    direScore: match.dire_score,
    startTime: match.start_time,
    isParsed,
    replayUrl: match.replay_url ?? null,
    buildingKills,
    players,
  };
}

const BUILDING_NAMES: Record<string, string> = {
  tower1: "T1",
  tower2: "T2",
  tower3: "T3",
  melee_rax: "Melee Rax",
  range_rax: "Range Rax",
  fort: "Ancient",
};

const LANE_NAMES: Record<string, string> = {
  top: "Top",
  mid: "Mid",
  bot: "Bot",
};

function parseBuildingKey(key: string): { building: string; team: "radiant" | "dire" } | null {
  // e.g. "npc_dota_goodguys_tower1_top" or "npc_dota_badguys_fort"
  const match = key.match(/^npc_dota_(goodguys|badguys)_(\w+?)(?:_(top|mid|bot))?$/);
  if (!match) return null;

  const team = match[1] === "goodguys" ? "radiant" as const : "dire" as const;
  const buildingType = match[2];
  const lane = match[3];

  const buildingLabel = BUILDING_NAMES[buildingType] ?? buildingType;
  const laneLabel = lane ? LANE_NAMES[lane] ?? lane : "";
  const teamLabel = team === "radiant" ? "Radiant" : "Dire";
  const building = laneLabel ? `${teamLabel} ${laneLabel} ${buildingLabel}` : `${teamLabel} ${buildingLabel}`;

  return { building, team };
}

function extractBuildingKills(match: OpenDotaMatch): BuildingKill[] {
  if (!match.objectives) return [];

  return match.objectives
    .filter((obj) => obj.type === "building_kill" && obj.key)
    .map((obj) => {
      const parsed = parseBuildingKey(obj.key!);
      if (!parsed) return null;

      return {
        time: obj.time,
        building: parsed.building,
        team: parsed.team,
        destroyerHeroName: obj.unit ?? null,
      };
    })
    .filter((x): x is BuildingKill => x !== null)
    .sort((a, b) => a.time - b.time);
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function getHeroImageUrl(heroName: string): string {
  // heroName from OpenDota is like "npc_dota_hero_antimage"
  const shortName = heroName.replace("npc_dota_hero_", "");
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${shortName}.png`;
}
