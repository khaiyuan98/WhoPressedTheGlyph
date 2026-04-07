"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { MatchGlyphResult, HeroData, GlyphEvent, BuildingKill } from "@/lib/types";
import MatchInfo from "./MatchInfo";
import TowerTimeline from "./TowerTimeline";
import PlayerCard from "./PlayerCard";

interface GlyphResultProps {
  match: MatchGlyphResult;
  heroes: Record<number, HeroData>;
}

// Valve keeps replays for approximately 13 days
const REPLAY_EXPIRY_DAYS = 13;

export default function GlyphResult({ match, heroes }: GlyphResultProps) {
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState<string | null>(null);
  const [glyphEvents, setGlyphEvents] = useState<GlyphEvent[]>([]);
  const [buildingKills, setBuildingKills] = useState<BuildingKill[]>(match.buildingKills);
  const [players, setPlayers] = useState(match.players);
  const [isParsed, setIsParsed] = useState(match.isParsed);
  const [loadingGlyphs, setLoadingGlyphs] = useState(false);
  const [glyphError, setGlyphError] = useState<string | null>(null);
  const [glyphStatus, setGlyphStatus] = useState<string | null>(null);
  const [parseRequested, setParseRequested] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollIntervalRef = useRef<number>(5000);
  const matchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const radiant = players.filter((p) => p.isRadiant);
  const dire = players.filter((p) => !p.isRadiant);

  // Check if replay is likely expired (older than ~13 days)
  const replayMayBeExpired =
    (Date.now() / 1000 - match.startTime) > REPLAY_EXPIRY_DAYS * 24 * 3600;

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
          "Parse requested! Waiting for OpenDota to finish parsing... results will auto-update."
        );
        // Track parse request separately from glyph status.
        // Don't set glyphStatus here — if STRATZ already cached glyph data,
        // glyph polling would return "completed" and reset the button/messages.
        setParseRequested(true);
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
        const events = data.glyphEvents ?? [];
        setGlyphEvents(events);
        // Stop polling
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (events.length === 0 && data.error) {
          setGlyphError(data.error);
        } else if (events.length === 0) {
          setGlyphError("No glyph events found for this match.");
        }
        // Re-fetch building kills if we have glyph data but no building kills
        // (happens when STRATZ returns data before OpenDota has parsed)
        if (events.length > 0) {
          setBuildingKills((prev) => {
            if (prev.length === 0) {
              fetch(`/api/matches/${match.matchId}`)
                .then((r) => r.json())
                .then((d) => {
                  if (d.match?.buildingKills?.length > 0) {
                    setBuildingKills(d.match.buildingKills);
                  }
                  if (d.match?.isParsed) {
                    setIsParsed(true);
                  }
                })
                .catch(() => {});
            }
            return prev;
          });
        }
      } else if (data.status === "failed" || data.status === "no_replay" || data.status === "error") {
        setGlyphError(data.error || "Replay parsing failed.");
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
      // If pending/parsing/parse_requested, keep polling
    } catch {
      setGlyphError("Network error. Please try again.");
    } finally {
      if (!isPolling) setLoadingGlyphs(false);
    }
  }, [match.matchId]);

  useEffect(() => {
    fetchGlyphs(false);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchGlyphs]);

  // Start/stop polling based on status.
  // parse_requested polls every 15s (waiting on OpenDota, takes minutes).
  // pending/parsing polls every 5s (Mac Mini is actively processing).
  useEffect(() => {
    const isActive =
      glyphStatus === "pending" ||
      glyphStatus === "parsing" ||
      glyphStatus === "parse_requested";

    if (!isActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const interval = glyphStatus === "parse_requested" ? 15000 : 5000;

    // Restart interval if the desired interval changed (e.g. parse_requested → pending)
    if (pollRef.current && pollIntervalRef.current !== interval) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!pollRef.current) {
      pollIntervalRef.current = interval;
      pollRef.current = setInterval(() => fetchGlyphs(true), interval);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [glyphStatus, fetchGlyphs]);

  // Clear parse message and request state when match becomes parsed
  useEffect(() => {
    if (isParsed) {
      setParseMsg(null);
      setParseRequested(false);
    }
  }, [isParsed]);

  // Poll match data from OpenDota when waiting for parse to complete.
  // Detects when OpenDota finishes parsing and auto-updates player stats,
  // building kills, and isParsed — so the user doesn't need to refresh.
  useEffect(() => {
    const shouldPoll =
      !isParsed &&
      (parseRequested ||
        glyphStatus === "pending" ||
        glyphStatus === "parsing");

    if (!shouldPoll) {
      if (matchPollRef.current) {
        clearInterval(matchPollRef.current);
        matchPollRef.current = null;
      }
      return;
    }

    if (!matchPollRef.current) {
      matchPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/matches/${match.matchId}`);
          const d = await res.json();
          if (d.match?.isParsed) {
            setIsParsed(true);
            setPlayers(d.match.players);
            if (d.match.buildingKills?.length > 0) {
              setBuildingKills(d.match.buildingKills);
            }
            // Stop polling — match is parsed
            if (matchPollRef.current) {
              clearInterval(matchPollRef.current);
              matchPollRef.current = null;
            }
          }
        } catch {
          // Ignore errors, will retry on next interval
        }
      }, 15000);
    }

    return () => {
      if (matchPollRef.current) {
        clearInterval(matchPollRef.current);
        matchPollRef.current = null;
      }
    };
  }, [isParsed, parseRequested, glyphStatus, match.matchId]);

  return (
    <div>
      <MatchInfo match={match} isParsed={isParsed} />

      {!isParsed && (
        <div className="mb-6 text-center">
          {replayMayBeExpired && (
            <p className="mb-3 text-sm text-orange-400">
              ⚠ This match is over {REPLAY_EXPIRY_DAYS} days old — we may not be able to find out who pressed the Glyph as the match recording might no longer be available.
            </p>
          )}
          <button
            onClick={handleRequestParse}
            disabled={parsing}
            className="px-6 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {parsing
              ? "Requesting..."
              : parseRequested
                ? "Parse Requested — Waiting for OpenDota"
                : glyphStatus === "pending" || glyphStatus === "parsing"
                  ? "Parse in Progress..."
                  : "Request Parse"}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            If parse doesn&apos;t complete after a few minutes, try clicking again.
          </p>
          {parseMsg && (
            <p className="mt-2 text-sm text-amber-300">{parseMsg}</p>
          )}
        </div>
      )}

      {/* Tower Timeline & Glyph Users */}
      <TowerTimeline
        buildingKills={buildingKills}
        glyphEvents={glyphEvents}
        players={players}
        heroes={heroes}
        loadingGlyphs={loadingGlyphs}
        glyphError={glyphError}
        glyphStatus={glyphStatus}
        matchDuration={match.duration}
      />

      {/* Team sections */}
      <div className="space-y-6">
        <TeamSection
          teamName="Radiant"
          players={radiant}
          heroes={heroes}
          isParsed={isParsed}
          isWinner={match.radiantWin}
        />
        <TeamSection
          teamName="Dire"
          players={dire}
          heroes={heroes}
          isParsed={isParsed}
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
