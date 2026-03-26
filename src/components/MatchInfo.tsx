import type { MatchGlyphResult } from "@/lib/types";
import { formatDuration } from "@/lib/opendota";

interface MatchInfoProps {
  match: MatchGlyphResult;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const mins = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${mins} UTC`;
}

export default function MatchInfo({ match }: MatchInfoProps) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Match {match.matchId}</h2>
          <div className="text-sm text-gray-400 mt-1">
            {formatDate(match.startTime)} &middot;{" "}
            {formatDuration(match.duration)}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-3 text-lg font-bold">
            <span className="text-green-400">{match.radiantScore}</span>
            <span
              className={`px-3 py-1 rounded text-sm ${
                match.radiantWin
                  ? "bg-green-900/50 text-green-400"
                  : "bg-red-900/50 text-red-400"
              }`}
            >
              {match.radiantWin ? "Radiant Victory" : "Dire Victory"}
            </span>
            <span className="text-red-400">{match.direScore}</span>
          </div>
        </div>
      </div>
      {!match.isParsed && (
        <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded text-yellow-300 text-sm">
          This match has not been parsed yet. Glyph data is only available for
          parsed matches. Click &quot;Request Parse&quot; below to parse it
          (replay must still be available on Valve servers, typically within ~2
          weeks of the match).
        </div>
      )}
    </div>
  );
}
