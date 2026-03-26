export interface OpenDotaPlayer {
  account_id: number | null;
  player_slot: number;
  team_number: number;
  team_slot: number;
  hero_id: number;
  personaname: string | null;
  name: string | null;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  gold_per_min: number;
  xp_per_min: number;
  level: number;
  net_worth: number;
  actions?: Record<string, number>;
  isRadiant: boolean;
}

export interface ObjectiveEvent {
  time: number;
  type: string;
  key?: string;
  unit?: string;
  slot?: number;
  player_slot?: number;
}

export interface OpenDotaMatch {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_score: number;
  dire_score: number;
  game_mode: number;
  lobby_type: number;
  tower_status_radiant: number;
  tower_status_dire: number;
  objectives: ObjectiveEvent[] | null;
  players: OpenDotaPlayer[];
  replay_url: string | null;
  version: number | null;
}

export interface ParseRequestResponse {
  job: {
    jobId: number;
  };
}

export interface ParseStatusResponse {
  jobId: number;
  type: string;
  timestamp: string;
  attempts: number;
}

export interface PlayerGlyphData {
  accountId: number | null;
  playerSlot: number;
  heroId: number;
  personaname: string | null;
  glyphUses: number;
  isRadiant: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

export interface BuildingKill {
  time: number;
  building: string;
  team: "radiant" | "dire";
  destroyerHeroName: string | null;
}

export interface GlyphEvent {
  time: number;
  playerSlot: number;
}

export interface MatchGlyphResult {
  matchId: number;
  duration: number;
  radiantWin: boolean;
  radiantScore: number;
  direScore: number;
  startTime: number;
  isParsed: boolean;
  replayUrl: string | null;
  buildingKills: BuildingKill[];
  players: PlayerGlyphData[];
}

// Hero data from OpenDota constants
export interface HeroData {
  id: number;
  name: string;
  localized_name: string;
  img: string;
  icon: string;
}
