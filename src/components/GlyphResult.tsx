"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MatchGlyphResult, HeroData, GlyphEvent } from "@/lib/types";
import MatchInfo from "./MatchInfo";
import TowerTimeline from "./TowerTimeline";
import PlayerCard from "./PlayerCard";

interface GlyphResultProps {
  match: MatchGlyphResult;
  heroes: Record<number, HeroData>;
}

export default function GlyphResult({ match, heroes }: GlyphResultProps) {
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [glyphEvents, setGlyphEvents] = useState<GlyphEvent[]>([]);
  const [loadingGlyphs, setLoadingGlyphs] = useState(false);
  const [glyphError, setGlyphError] = useState<string | null>(null);
  const [glyphStatus, setGlyphStatus] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const radiant = match.players.filter((p) => p.isRadiant);
  const dire = match.players.filter((p) => !p.isRadiant);

  async function handleRequestParse() {
    setParsing(true);
    setParseMsg(null);
    try {
      const res = await fetch(`/api/parse/${match.matchId}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setParseMsg(data.error || "Failed to request parse");
      } else {
        setParseMsg(
          "Parse requested! This usually takes 1-5 minutes. Refresh the page to check for results."
        );
      }
    } catch {
      setParseMsg("Network error. Please try again.");
    } finally {
      setParsing(false);
    }
  }

  const fetchGlyphs = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoadingGlyphs(true);
    setGlyphError(null);
    try {
      const res = await fetch(`/api/glyph/${match.matchId}`);
      const data = await res.json();
      if (!res.ok) {
        setGlyphError(data.error || "Failed to fetch glyph timestamps");
        setGlyphStatus("failed");
        return;
      }

      setGlyphStatus(data.status);

      if (data.status === "completed") {
        setGlyphEvents(data.glyphEvents ?? []);
        // Stop polling
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if ((data.glyphEvents ?? []).length === 0 && data.error) {
          setGlyphError(data.error);
        } else if ((data.glyphEvents ?? []).length === 0) {
          setGlyphError("No glyph events found for this match.");
        }
      } else if (data.status === "failed") {
        setGlyphError(data.error || "Replay parsing failed.");
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
      // If pending/parsing, keep polling
    } catch {
      setGlyphError("Network error. Please try again.");
    } finally {
      if (!isPolling) setLoadingGlyphs(false);
    }
  }, [match.matchId]);

  useEffect(() => {
    fetchGlyphs(false).then(() => {
      // If status is pending/parsing, start polling every 5 seconds
    });

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchGlyphs]);

  // Start/stop polling based on status
  useEffect(() => {
    if (
      (glyphStatus === "pending" || glyphStatus === "parsing") &&
      !pollRef.current
    ) {
      pollRef.current = setInterval(() => fetchGlyphs(true), 5000);
    }
    return () => {
      if (
        glyphStatus !== "pending" &&
        glyphStatus !== "parsing" &&
        pollRef.current
      ) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [glyphStatus, fetchGlyphs]);

  return (
    <div>
      <MatchInfo match={match} />

      {!match.isParsed && (
        <div className="mb-6 text-center">
          <button
            onClick={handleRequestParse}
            disabled={parsing}
            className="px-6 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {parsing ? "Requesting..." : "Request Parse"}
          </button>
          {parseMsg && (
            <p className="mt-2 text-sm text-amber-300">{parseMsg}</p>
          )}
        </div>
      )}

      {/* Tower Timeline & Glyph Users */}
      <TowerTimeline
        buildingKills={match.buildingKills}
        glyphEvents={glyphEvents}
        players={match.players}
        heroes={heroes}
        loadingGlyphs={loadingGlyphs}
        glyphError={glyphError}
        glyphStatus={glyphStatus}
      />

      {/* Team sections */}
      <div className="space-y-6">
        <TeamSection
          teamName="Radiant"
          players={radiant}
          heroes={heroes}
          isParsed={match.isParsed}
          isWinner={match.radiantWin}
        />
        <TeamSection
          teamName="Dire"
          players={dire}
          heroes={heroes}
          isParsed={match.isParsed}
          isWinner={!match.radiantWin}
        />
      </div>
    </div>
  );
}

function TeamSection({
  teamName,
  players,
  heroes,
  isParsed,
  isWinner,
}: {
  teamName: string;
  players: GlyphResultProps["match"]["players"];
  heroes: Record<number, HeroData>;
  isParsed: boolean;
  isWinner: boolean;
}) {
  const totalGlyphs = players.reduce((sum, p) => sum + p.glyphUses, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`text-lg font-bold ${
            teamName === "Radiant" ? "text-green-400" : "text-red-400"
          }`}
        >
          {teamName} {isWinner && "(Winner)"}
        </h3>
        {isParsed && (
          <span className="text-sm text-gray-400">
            Total glyphs: {totalGlyphs}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {players.map((p) => (
          <PlayerCard
            key={p.playerSlot}
            player={p}
            hero={heroes[p.heroId]}
            isParsed={isParsed}
          />
        ))}
      </div>
    </div>
  );
}
