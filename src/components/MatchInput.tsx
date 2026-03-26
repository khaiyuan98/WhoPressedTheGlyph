"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MatchInput() {
  const [matchId, setMatchId] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = matchId.trim();
    if (trimmed && /^\d+$/.test(trimmed)) {
      router.push(`/matches/${trimmed}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={matchId}
        onChange={(e) => setMatchId(e.target.value)}
        placeholder="Enter Match ID (e.g. 8123456789)"
        className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-lg"
      />
      <button
        type="submit"
        disabled={!matchId.trim() || !/^\d+$/.test(matchId.trim())}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
      >
        Search
      </button>
    </form>
  );
}
