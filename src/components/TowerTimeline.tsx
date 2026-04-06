import type {
  BuildingKill,
  GlyphEvent,
  PlayerGlyphData,
  HeroData,
} from "@/lib/types";
import { formatDuration, getHeroImageUrl } from "@/lib/opendota";

interface TowerTimelineProps {
  buildingKills: BuildingKill[];
  glyphEvents: GlyphEvent[];
  players: PlayerGlyphData[];
  heroes: Record<number, HeroData>;
  loadingGlyphs: boolean;
  glyphError: string | null;
  glyphStatus: string | null;
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
}: TowerTimelineProps) {
  const glyphUsers = players.filter((p) => p.glyphUses > 0);
  const radiantGlyphUsers = glyphUsers.filter((p) => p.isRadiant);
  const direGlyphUsers = glyphUsers.filter((p) => !p.isRadiant);

  // Build lookups
  const heroByName: Record<string, HeroData> = {};
  const playerBySlot: Record<number, PlayerGlyphData> = {};
  for (const p of players) {
    playerBySlot[p.playerSlot] = p;
    const hero = heroes[p.heroId];
    if (hero) heroByName[hero.name] = hero;
  }

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
        />
        <GlyphUserList
          team="Dire"
          users={direGlyphUsers}
          heroes={heroes}
        />
      </div>

      {/* Glyph loading status */}
      {loadingGlyphs && (
        <p className="mb-4 text-sm text-amber-400 text-center animate-pulse">
          Loading glyph timestamps...
        </p>
      )}
      {!loadingGlyphs && (glyphStatus === "pending" || glyphStatus === "parsing") && (
        <p className="mb-4 text-sm text-amber-400 text-center animate-pulse">
          {glyphStatus === "pending"
            ? "Waiting for replay parser to pick up this match..."
            : "Parsing replay... this may take a few minutes"}
        </p>
      )}
      {glyphError && !loadingGlyphs && glyphStatus !== "pending" && glyphStatus !== "parsing" && (
        <p className="mb-4 text-sm text-red-400 text-center">{glyphError}</p>
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
}: {
  event: GlyphEvent;
  player: PlayerGlyphData | undefined;
  heroes: Record<number, HeroData>;
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

  return (
    <div
      className={`flex items-center gap-3 py-1.5 px-3 rounded border ${bgColor}`}
    >
      <span
        className={`text-sm font-mono w-12 flex-shrink-0 ${teamColor}`}
      >
        {formatDuration(event.time)}
      </span>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
      <span className={`text-sm font-medium flex-1 ${teamColor}`}>
        {teamLabel ? `${teamLabel} Glyph` : "Glyph used"}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
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
  );
}

function GlyphUserList({
  team,
  users,
  heroes,
}: {
  team: string;
  users: PlayerGlyphData[];
  heroes: Record<number, HeroData>;
}) {
  const teamColor = team === "Radiant" ? "text-green-400" : "text-red-400";

  return (
    <div>
      <h4 className={`text-sm font-bold ${teamColor} mb-1.5`}>{team}</h4>
      {users.length === 0 ? (
        <p className="text-xs text-gray-500">No glyph usage</p>
      ) : (
        <div className="space-y-1.5">
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
