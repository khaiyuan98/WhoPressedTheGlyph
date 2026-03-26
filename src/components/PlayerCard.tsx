import type { PlayerGlyphData, HeroData } from "@/lib/types";
import { getHeroImageUrl } from "@/lib/opendota";

interface PlayerCardProps {
  player: PlayerGlyphData;
  hero: HeroData | undefined;
  isParsed: boolean;
}

export default function PlayerCard({
  player,
  hero,
  isParsed,
}: PlayerCardProps) {
  const heroName = hero?.localized_name ?? `Hero ${player.heroId}`;
  const heroImg = hero ? getHeroImageUrl(hero.name) : null;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg ${
        player.glyphUses > 0
          ? "bg-amber-900/30 border border-amber-600/50"
          : "bg-gray-800/50 border border-gray-700/50"
      }`}
    >
      {/* Hero image */}
      <div className="w-16 h-9 rounded overflow-hidden bg-gray-700 flex-shrink-0">
        {heroImg && (
          <img
            src={heroImg}
            alt={heroName}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Player info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {player.personaname ?? "Anonymous"}
        </div>
        <div className="text-sm text-gray-400">{heroName}</div>
      </div>

      {/* KDA */}
      <div className="text-sm text-gray-400 hidden sm:block">
        <span className="text-green-400">{player.kills}</span>/
        <span className="text-red-400">{player.deaths}</span>/
        <span className="text-blue-400">{player.assists}</span>
      </div>

      {/* Glyph count */}
      <div className="text-right flex-shrink-0 w-20">
        {isParsed ? (
          <div
            className={`text-lg font-bold ${
              player.glyphUses > 0 ? "text-amber-400" : "text-gray-500"
            }`}
          >
            {player.glyphUses > 0 ? `${player.glyphUses}x` : "-"}
          </div>
        ) : (
          <div className="text-sm text-gray-500">N/A</div>
        )}
        <div className="text-xs text-gray-500">
          {isParsed ? "glyph" : "not parsed"}
        </div>
      </div>
    </div>
  );
}
