# Who Pressed The Glyph?

Dota 2 match analyzer that reveals who pressed the Glyph of Fortification — with exact timestamps, hero attribution, and a building destruction timeline.

**Live:** [who-pressed-the-glyph.vercel.app](https://who-pressed-the-glyph.vercel.app/)

## Features

- **Glyph Attribution** — See which player on each team used Glyph and how many times
- **Glyph Timestamps** — Exact game-time moments when Glyph was pressed, loaded automatically
- **Match Timeline** — Combined chronological view of building destructions and glyph events
- **Team Colors** — Radiant (green) and Dire (red) visual distinction throughout
- **Hero Images** — Player hero portraits from Valve's CDN
- **Parse Requests** — Request OpenDota replay parsing for unparsed matches
- **Async Replay Parsing** — Self-hosted parser with Supabase queue for matches STRATZ doesn't cover
- **Smart Caching** — All glyph results (STRATZ + parser) are cached in Supabase for instant repeat visits

## How It Works

1. Enter a Dota 2 match ID
2. The app fetches match data from **OpenDota** (player stats, glyph counts, building kills)
3. Glyph timestamps are loaded automatically:
   - **Supabase cache** is checked first (instant for previously viewed matches)
   - If not cached, **STRATZ API** is queried (results are saved to cache for future visits)
   - If STRATZ has no data, an async parse job is created — a self-hosted **replay parser** on a Mac Mini picks it up
4. The timeline merges building destructions with glyph events, showing who glyphed and when

### Hero Attribution Logic

STRATZ provides glyph timestamps + team (Radiant/Dire). OpenDota provides per-player glyph counts. The app builds a queue of heroes per team (repeated by their glyph count) and assigns them chronologically to each glyph event.

## Tech Stack

- **Next.js 16** (App Router) with **React 19** and **TypeScript 6**
- **Tailwind CSS 4** for styling
- **Supabase** for async parse job queue and result caching
- **odota/parser** (Docker) for self-hosted replay parsing
- Deployed on **Vercel**

## Getting Started

### Prerequisites

- Node.js 22+
- A free [STRATZ API key](https://stratz.com/api)
- A [Supabase](https://supabase.com) project (free tier)

### Setup

```bash
git clone https://github.com/jefferyleo/WhoPressedTheGlyph.git
cd WhoPressedTheGlyph
npm install
```

Create a `.env.local` file:

```env
STRATZ_API_KEY=your_stratz_api_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Create the Supabase table (run in SQL Editor):

```sql
CREATE TABLE glyph_events (
  match_id BIGINT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  glyph_data JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Development

```bash
npm run dev    # Start dev server on http://localhost:3000
npm run build  # Production build
npm run lint   # Run ESLint
```

### Self-Hosted Parser (Optional)

For matches where STRATZ doesn't have glyph timestamps, you can run a self-hosted replay parser:

```bash
# Start the Docker parser
docker run -d --restart unless-stopped -p 5600:5600 --name dota2-parser odota/parser

# Add to .env.local
# PARSER_URL=http://localhost:5600

# Run the parser worker (polls Supabase for pending jobs)
npm run parser-worker
```

The worker polls Supabase every 30 seconds, downloads replays, parses them locally, and writes glyph timestamps back to Supabase.

## Data Sources

| Source | Auth | Provides |
|--------|------|----------|
| [OpenDota API](https://docs.opendota.com/) | None (free) | Match data, player stats, per-player glyph counts, building kill objectives |
| [STRATZ GraphQL API](https://stratz.com/api) | Free API key | Glyph timestamps, team attribution |
| [Supabase](https://supabase.com) | Free tier | Parse job queue, cached glyph results (STRATZ + parser) |
| [odota/parser](https://github.com/odota/parser) | Self-hosted Docker | Replay parsing for glyph timestamp extraction |

## Environment Variables

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `STRATZ_API_KEY` | Yes | Vercel + local | Bearer token for STRATZ GraphQL API |
| `SUPABASE_URL` | Yes | Vercel + local + Mac Mini | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Vercel + local + Mac Mini | Supabase service role key |
| `PARSER_URL` | No | Mac Mini only | URL for odota/parser (`http://localhost:5600`) |

## Project Structure

```
src/
  app/
    page.tsx                    # Homepage with match ID search
    matches/[id]/page.tsx       # Match detail page (server component)
    api/
      glyph/[id]/route.ts      # Unified glyph endpoint (cache -> STRATZ -> queue)
      stratz/[id]/route.ts      # STRATZ glyph timestamps
      parse/[id]/route.ts       # OpenDota parse request
      replay/[id]/route.ts      # Legacy direct replay parser route
  components/
    GlyphResult.tsx             # Main result component with auto-fetch + polling
    TowerTimeline.tsx           # Timeline with building kills + glyph events
    PlayerCard.tsx              # Player card with hero and stats
    MatchInfo.tsx               # Match info header
    MatchInput.tsx              # Match ID search input
  lib/
    stratz.ts                   # Shared STRATZ fetching logic
    supabase.ts                 # Supabase client and queue helpers
    opendota.ts                 # OpenDota API client and data transforms
    types.ts                    # TypeScript interfaces
scripts/
  parser-worker.ts              # Mac Mini worker for async replay parsing
```

## Architecture

```
User -> Vercel (Next.js)
          |
          +-> Supabase cache (fastest — instant for repeat visits)
          |     * both STRATZ and parser results are cached here
          |
          +-> STRATZ API (primary source — results saved to cache)
          |
          +-> Supabase queue (create pending job if no data)
                  |
          Mac Mini Worker (polls every 30s)
            -> downloads replay .dem.bz2 from Valve
            -> decompresses with bunzip2
            -> POSTs raw .dem to odota/parser (Docker)
            -> extracts CHAT_MESSAGE_GLYPH_USED events
            -> attributes heroes using OpenDota glyph counts
            -> writes results to Supabase
                  |
          User's browser <- polls every 5s (auto-updates when done)
```

## Deployment

- **App:** Auto-deploys to Vercel on push to `main`
- **Supabase:** Connected via Vercel integration (env vars auto-configured)
- **Parser:** Self-hosted on Mac Mini with Docker

## CI/CD

GitHub Actions runs lint and build on every push to `main` and on pull requests.

## License

MIT
