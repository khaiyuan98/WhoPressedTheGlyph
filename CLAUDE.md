# Who Pressed The Glyph

Dota 2 match analyzer that shows who pressed the Glyph of Fortification.

## Tech Stack

- Next.js 16 (App Router) with React 19 and TypeScript 6
- Tailwind CSS 4 for styling
- Supabase for async parse job queue and result caching
- Deployed on Vercel: https://who-pressed-the-glyph.vercel.app/

## Architecture

### Data Sources

1. **OpenDota API** (free, no key): match data, player info, per-player glyph counts via `actions["24"]`, building kill objectives
2. **STRATZ GraphQL API** (free key required via `STRATZ_API_KEY`): glyph timestamps from `chatEvents` (type 12 = `CHAT_MESSAGE_GLYPH_USED`), includes `isRadiant` field
3. **Supabase** (free tier): stores parse job queue and cached glyph results from the replay parser
4. **odota/parser** (self-hosted Docker): parses Dota 2 replay files to extract glyph timestamps when STRATZ has no data

### Glyph Timestamp Flow

The app uses a tiered approach to get glyph timestamps:

1. **Supabase cache** (fastest) — check if this match was already fetched/parsed; both STRATZ and parser results are cached here
2. **STRATZ API** (primary source) — if no cache, query STRATZ; results are saved to Supabase for future requests
3. **Parser queue** (async fallback) — if STRATZ has no data, create a "pending" job in Supabase; a worker on the Mac Mini picks it up, parses the replay, and writes results back

### Hero Attribution Logic

Both STRATZ and parser routes use the same strategy: get per-player glyph counts from OpenDota, build a queue of hero IDs per team (repeated by count), and assign them chronologically to glyph events. The parser identifies teams via `player1` field (2 = Radiant, 3 = Dire in Dota 2).

### Key Files

- `src/app/page.tsx` - Homepage with match ID search
- `src/app/matches/[id]/page.tsx` - Match detail page (server component, fetches from OpenDota)
- `src/app/api/glyph/[id]/route.ts` - Unified glyph endpoint: Supabase cache -> STRATZ (saves to cache) -> pending job
- `src/app/api/stratz/[id]/route.ts` - STRATZ API route (also used directly by glyph route)
- `src/app/api/replay/[id]/route.ts` - Legacy direct replay parser route (needs PARSER_URL)
- `src/app/api/parse/[id]/route.ts` - OpenDota parse request route
- `src/lib/stratz.ts` - Shared STRATZ fetching logic with hero attribution
- `src/lib/supabase.ts` - Supabase client, cache/queue helpers, `saveGlyphEvents()` for caching STRATZ results
- `src/lib/opendota.ts` - OpenDota API client, data transforms, building kill extraction
- `src/lib/types.ts` - TypeScript interfaces (OpenDotaMatch, GlyphEvent, MatchGlyphResult, etc.)
- `src/components/GlyphResult.tsx` - Main result component; auto-fetches glyph timestamps, polls for parser results
- `src/components/TowerTimeline.tsx` - Timeline with building kills + glyph events, shows parse status
- `src/components/PlayerCard.tsx` - Player card with hero image and stats
- `src/components/MatchInfo.tsx` - Match info header
- `scripts/parser-worker.ts` - Mac Mini worker: polls Supabase for pending jobs, downloads/parses replays locally

### Data Flow

1. User enters match ID on homepage
2. Server component (`matches/[id]/page.tsx`) fetches match + heroes from OpenDota
3. `transformMatchData()` extracts player stats, glyph counts, building kills
4. Client component (`GlyphResult`) auto-fetches `/api/glyph/[id]` on mount
5. Glyph route checks Supabase cache first (instant for repeat visits), then STRATZ (saves to cache), then creates pending parser job
6. If pending/parsing, client polls every 5 seconds until completed
7. Mac Mini worker picks up pending jobs, parses replays, writes results to Supabase
8. All sources (STRATZ + parser) cache results in Supabase — subsequent visits are instant

### Parser Worker Architecture

```
Vercel app -> Supabase (create pending job)
                  |
Mac Mini worker (polls every 30s)
  -> picks up pending job
  -> downloads replay .dem.bz2 from Valve
  -> decompresses with bunzip2
  -> POSTs raw .dem to odota/parser on localhost:5600
  -> extracts CHAT_MESSAGE_GLYPH_USED events from NDJSON
  -> attributes heroes using OpenDota glyph counts
  -> writes results back to Supabase
                  |
Vercel app <- polls Supabase (finds completed results)
```

## Environment Variables

### Vercel (Production)
- `STRATZ_API_KEY` (required) - Bearer token for STRATZ GraphQL API
- `SUPABASE_URL` (required) - Supabase project URL (set via Vercel integration)
- `SUPABASE_SERVICE_ROLE_KEY` (required) - Supabase service role key (set via Vercel integration)

### Mac Mini (Parser Worker)
- `SUPABASE_URL` (required) - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` (required) - Supabase service role key
- `PARSER_URL` (required) - `http://localhost:5600` (local odota/parser Docker)

### Local Development
- All of the above, in `.env.local`

## Dev Commands

```bash
npm run dev            # Start dev server on port 3000
npm run build          # Production build
npm run lint           # ESLint
npm run parser-worker  # Run parser worker (on Mac Mini)
```

## Mac Mini Setup

```bash
# Run the replay parser
docker run -d --restart unless-stopped -p 5600:5600 --name dota2-parser odota/parser

# Run the worker (in project directory with .env.local)
npm run parser-worker
```

## CI/CD

- GitHub Actions: lint + build on push to main
- Vercel: auto-deploy on push to main
- Supabase: connected via Vercel integration

## Supabase Schema

```sql
CREATE TABLE glyph_events (
  match_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, parsing, completed, failed
  glyph_data JSONB,                        -- GlyphEvent[] when completed
  error TEXT,                               -- error message when failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
