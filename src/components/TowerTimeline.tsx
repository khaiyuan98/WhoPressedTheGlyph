import type {
  BuildingKill,
  GlyphEvent,
  PlayerGlyphData,
  HeroData,
} from "@/lib/types";
import { formatDuration, getHeroImageUrl } from "@/lib/opendota";
import { analyzeAllGlyphs, getTeamSummaries, type GlyphAnalysis, type TeamGlyphSummary } from "@/lib/glyphAnalysis";

const TAG_TOOLTIPS: Record<string, string> = {
  "Panic Glyph": "Glyph was used within 3 seconds of a building being destroyed — likely a panic reaction.",
  "Clutch Save": "Buildings were actively falling, but nothing else was lost after the glyph — a clutch defensive play.",
  "Free Glyph": "A tower or melee barracks fell during or just before this glyph, which resets the cooldown — so this glyph cost nothing.",
  "Grief Glyph": "Glyph was used before the 5-minute mark with zero building activity — likely pressed by accident or for trolling.",
  "High Stakes": "This glyph was used to protect barracks or the Ancient — the most critical buildings in the game.",
  "Offensive Glyph": "Glyph was used while your team was pushing the enemy base — likely to protect your own buildings back home.",
};

interface TowerTimelineProps {
  buildingKills: BuildingKill[];
  glyphEvents: GlyphEvent[];
  players: PlayerGlyphData[];
  heroes: Record<number, HeroData>;
  loadingGlyphs: boolean;
  glyphError: string | null;
  glyphStatus: string | null;
  matchDuration: number;
}

type TimelineEntry =
  | { kind: "building"; data: BuildingKill; time: number }
  | { kind: "glyph"; data: GlyphEvent; player: PlayerGlyphData | undefined; time: number };

export default function TowerTimeline({
  buildingKills,
  glyphEvents,
  players,
  heroes,
  loadingGlyphs,
  glyphError,
  glyphStatus,
  matchDuration,
}: TowerTimelineProps) {
  const glyphUsers = players.filter((p) => p.glyphUses > 0);
  const radiantGlyphUsers = glyphUsers.filter((p) => p.isRadiant);
  const direGlyphUsers = glyphUsers.filter((p) => !p.isRadiant);

  // Fallback team totals from STRATZ events when OpenDota per-player data is unavailable
  const radiantGlyphCountFromEvents = glyphEvents.filter((e) => e.isRadiant === true).length;
  const direGlyphCountFromEvents = glyphEvents.filter((e) => e.isRadiant === false).length;

  // Build lookups
  const heroByName: Record<string, HeroData> = {};
  const playerBySlot: Record<number, PlayerGlyphData> = {};
  for (const p of players) {
    playerBySlot[p.playerSlot] = p;
    const hero = heroes[p.heroId];
    if (hero) heroByName[hero.name] = hero;
  }

  // Analyze glyph effectiveness
  const glyphAnalyses = glyphEvents.length > 0 && buildingKills.length > 0
    ? analyzeAllGlyphs(glyphEvents, buildingKills, matchDuration)
    : [];
  const analysisMap = new Map<number, GlyphAnalysis>();
  for (const a of glyphAnalyses) {
    analysisMap.set(a.glyphEvent.time, a);
  }

  // Team summaries
  const teamSummaries = glyphAnalyses.length > 0
    ? getTeamSummaries(glyphAnalyses)
    : null;

  // Merge building kills and glyph events into a single sorted timeline
  const timeline: TimelineEntry[] = [
    ...buildingKills.map(
      (k): TimelineEntry => ({ kind: "building", data: k, time: k.time })
    ),
    ...glyphEvents.map(
      (g): TimelineEntry => ({
        kind: "glyph",
        data: g,
        player: playerBySlot[g.playerSlot],
        time: g.time,
      })
    ),
  ].sort((a, b) => a.time - b.time);

  const hasGlyphTimestamps = glyphEvents.length > 0;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6">
      {/* Glyph Users Summary */}
      <h3 className="text-lg font-bold mb-3">Glyph Users</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <GlyphUserList
          team="Radiant"
          users={radiantGlyphUsers}
          heroes={heroes}
          glyphCountFromEvents={radiantGlyphCountFromEvents}
        />
        <GlyphUserList
          team="Dire"
          users={direGlyphUsers}
          heroes={heroes}
          glyphCountFromEvents={direGlyphCountFromEvents}
        />
      </div>

      {/* Glyph loading status */}
      {loadingGlyphs && (
        <p className="mb-4 text-sm text-amber-400 text-center animate-pulse">
          Loading glyph timestamps...
        </p>
      )}
      {!loadingGlyphs && (glyphStatus === "parse_requested" || glyphStatus === "pending" || glyphStatus === "parsing") && (
        <div className="mb-4 text-center">
          <p className="text-sm text-amber-400 animate-pulse">
            {glyphStatus === "parse_requested"
              ? "Waiting for OpenDota to finish parsing the replay..."
              : glyphStatus === "pending"
                ? "Replay parsed — queued for glyph extraction..."
                : "Extracting glyph timestamps from replay..."}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {glyphStatus === "parse_requested"
              ? "This page will automatically update when results are ready. No need to refresh."
              : "This page will automatically update in a few moments."}
          </p>
        </div>
      )}
      {glyphError && !loadingGlyphs && glyphStatus !== "parse_requested" && glyphStatus !== "pending" && glyphStatus !== "parsing" && (
        <p className={`mb-4 text-sm text-center ${glyphStatus === "no_replay" ? "text-amber-400" : "text-red-400"}`}>
          {glyphError}
        </p>
      )}

      {/* Team Glyph Efficiency Summary */}
      {teamSummaries && (teamSummaries.radiant.total > 0 || teamSummaries.dire.total > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <EfficiencyCard summary={teamSummaries.radiant} />
          <EfficiencyCard summary={teamSummaries.dire} />
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <>
          <h3 className="text-lg font-bold mb-3">
            Match Timeline
          </h3>
          <div className="space-y-1">
            {timeline.map((entry, i) => {
              if (entry.kind === "building") {
                return (
                  <BuildingRow
                    key={`b-${i}`}
                    kill={entry.data}
                    heroByName={heroByName}
                  />
                );
              } else {
                return (
                  <GlyphRow
                    key={`g-${i}`}
                    event={entry.data}
                    player={entry.player}
                    heroes={heroes}
                    analysis={analysisMap.get(entry.data.time)}
                  />
                );
              }
            })}
          </div>
        </>
      )}

      {timeline.length === 0 && (
        <p className="text-sm text-gray-500">
          No timeline data available.
        </p>
      )}
    </div>
  );
}

function BuildingRow({
  kill,
  heroByName,
}: {
  kill: BuildingKill;
  heroByName: Record<string, HeroData>;
}) {
  const destroyerHero = kill.destroyerHeroName
    ? heroByName[kill.destroyerHeroName]
    : null;
  const heroImg = destroyerHero ? getHeroImageUrl(destroyerHero.name) : null;
  const isRadiant = kill.team === "radiant";

  return (
    <div className="flex items-center gap-3 py-1.5 px-3 rounded bg-gray-900/50">
      <span className="text-sm text-gray-400 font-mono w-12 flex-shrink-0">
        {formatDuration(kill.time)}
      </span>
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isRadiant ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span
        className={`text-sm font-medium flex-1 ${
          isRadiant ? "text-green-300" : "text-red-300"
        }`}
      >
        {kill.building} Destroyed
      </span>
      {destroyerHero && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {heroImg && (
            <img
              src={heroImg}
              alt={destroyerHero.localized_name}
              className="w-8 h-[18px] rounded object-cover"
            />
          )}
          <span className="text-xs text-gray-400 hidden sm:inline">
            {destroyerHero.localized_name}
          </span>
        </div>
      )}
    </div>
  );
}

function GlyphRow({
  event,
  player,
  heroes,
  analysis,
}: {
  event: GlyphEvent;
  player: PlayerGlyphData | undefined;
  heroes: Record<number, HeroData>;
  analysis?: GlyphAnalysis;
}) {
  // Use heroId from event (STRATZ attribution) or fall back to player data
  const heroId = event.heroId ?? player?.heroId;
  const hero = heroId ? heroes[heroId] : null;
  const heroImg = hero ? getHeroImageUrl(hero.name) : null;
  const playerName = player?.personaname ?? (hero?.localized_name ?? null);
  const isRadiant = event.isRadiant;

  // Team-colored styling
  const teamColor =
    isRadiant === true
      ? "text-green-400"
      : isRadiant === false
        ? "text-red-400"
        : "text-amber-300";
  const teamLabel =
    isRadiant === true
      ? "Radiant"
      : isRadiant === false
        ? "Dire"
        : "";
  const dotColor =
    isRadiant === true
      ? "bg-green-500"
      : isRadiant === false
        ? "bg-red-500"
        : "bg-amber-500";
  const bgColor =
    isRadiant === true
      ? "bg-green-900/20 border-green-700/30"
      : isRadiant === false
        ? "bg-red-900/20 border-red-700/30"
        : "bg-amber-900/30 border-amber-700/30";

  // Analysis badge colors
  const labelColors: Record<string, string> = {
    "Effective": "bg-green-700/60 text-green-300",
    "Possibly Effective": "bg-blue-700/50 text-blue-300",
    "Questionable": "bg-amber-700/50 text-amber-300",
    "Likely Wasted": "bg-red-700/50 text-red-300",
  };

  return (
    <div className={`rounded border ${bgColor}`}>
      <div className="flex items-center gap-3 py-1.5 px-3">
        <span
          className={`text-sm font-mono w-12 flex-shrink-0 ${teamColor}`}
        >
          {formatDuration(event.time)}
        </span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className={`text-sm font-medium ${teamColor}`}>
          {teamLabel ? `${teamLabel} Glyph` : "Glyph used"}
        </span>
        {analysis && (
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${labelColors[analysis.label] ?? "bg-gray-700 text-gray-300"}`}
          >
            {analysis.label}
          </span>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          {heroImg && (
            <img
              src={heroImg}
              alt={hero?.localized_name ?? ""}
              className="w-8 h-[18px] rounded object-cover"
            />
          )}
          {playerName && (
            <span className={`text-xs hidden sm:inline ${teamColor}`}>
              {playerName}
            </span>
          )}
        </div>
      </div>
      {analysis && (
        <div className="px-3 pb-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-gray-400 italic ml-[68px]">
            {analysis.reason}
          </span>
          {analysis.tags.map((tag) => (
            <span
              key={tag}
              title={TAG_TOOLTIPS[tag] ?? ""}
              className="text-[10px] bg-gray-700/60 text-gray-300 px-1.5 py-0.5 rounded cursor-help"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GlyphUserList({
  team,
  users,
  heroes,
  glyphCountFromEvents,
}: {
  team: string;
  users: PlayerGlyphData[];
  heroes: Record<number, HeroData>;
  glyphCountFromEvents: number;
}) {
  const teamColor = team === "Radiant" ? "text-green-400" : "text-red-400";

  return (
    <div>
      <h4 className={`text-sm font-bold ${teamColor} mb-1.5`}>{team}</h4>
      {users.length === 0 && glyphCountFromEvents === 0 ? (
        <p className="text-xs text-gray-500">No glyph usage</p>
      ) : users.length === 0 ? (
        <div className="bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1.5">
          <p className="text-xs text-amber-300">
            {glyphCountFromEvents}× glyph used
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Request Parse for per-hero breakdown
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1.5 mb-1">
            <p className="text-xs text-amber-300">
              {users.reduce((sum, u) => sum + u.glyphUses, 0)}× glyph used
            </p>
          </div>
          {users.map((u) => {
            const hero = heroes[u.heroId];
            const heroImg = hero ? getHeroImageUrl(hero.name) : null;
            return (
              <div
                key={u.playerSlot}
                className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1"
              >
                {heroImg && (
                  <img
                    src={heroImg}
                    alt={hero?.localized_name ?? ""}
                    className="w-10 h-6 rounded object-cover"
                  />
                )}
                <span className="text-sm text-amber-300 truncate">
                  {u.personaname ?? "Anonymous"}
                </span>
                <span className="text-sm text-amber-500 font-bold ml-auto">
                  {u.glyphUses}x
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EfficiencyCard({ summary }: { summary: TeamGlyphSummary }) {
  if (summary.total === 0) return null;

  const teamColor = summary.team === "radiant" ? "text-green-400" : "text-red-400";
  const teamLabel = summary.team === "radiant" ? "Radiant" : "Dire";
  const pct = summary.effectivenessPercent;
  const barColor =
    pct >= 60 ? "bg-green-500" : pct >= 30 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-bold ${teamColor}`}>
          {teamLabel} Glyph Efficiency
        </span>
        <span className="text-xs text-gray-300 font-semibold">
          {summary.effective}/{summary.total} ({pct}%)
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-3 mt-1.5 text-[10px] text-gray-500">
        <span>{summary.effective} effective</span>
        {summary.questionable > 0 && <span>{summary.questionable} questionable</span>}
        {summary.wasted > 0 && <span>{summary.wasted} wasted</span>}
      </div>
    </div>
  );
}
