import Link from "next/link";
import GlyphResult from "@/components/GlyphResult";
import { getMatch, getHeroes, transformMatchData } from "@/lib/opendota";

interface MatchPageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchPage({ params }: MatchPageProps) {
  const { id } = await params;

  if (!id || !/^\d+$/.test(id)) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold text-red-400 mb-2">
          Invalid Match ID
        </h1>
        <p className="text-gray-400">Match ID must be a number.</p>
        <Link href="/" className="text-amber-500 hover:underline mt-4 block">
          Go back
        </Link>
      </div>
    );
  }

  try {
    const [match, heroes] = await Promise.all([getMatch(id), getHeroes()]);
    const result = transformMatchData(match);

    return (
      <div>
        <Link
          href="/"
          className="text-amber-500 hover:underline mb-6 inline-block"
        >
          &larr; Search another match
        </Link>
        <GlyphResult match={result} heroes={heroes} />
      </div>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load match";
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold text-red-400 mb-2">Error</h1>
        <p className="text-gray-400">{message}</p>
        <Link href="/" className="text-amber-500 hover:underline mt-4 block">
          Go back
        </Link>
      </div>
    );
  }
}
