# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Start Checklist

At the start of every session, read:
1. **`adr/index.md`** — index of all architectural decisions; keep these in mind for all changes
2. **`development-docs/systems/index.md`** — index of all systems; use this to locate relevant code before making changes

Whenever a new architectural decision is made during a session, encode it in a new ADR under `adr/` and add it to `adr/index.md`.

## Documentation Maintenance

**No code change is complete without also updating documentation.**

After any code change:
- If a system's behavior changed: update the relevant `development-docs/systems/<system>/documentation.md`
- If an architectural decision was made or changed: create or update the relevant `adr/` file
- If a feature request was completed: move it to `feature-requests/complete/` with the next sequential number (e.g. `0005-my-feature.md`)

Do not create documentation or work files outside `adr/`, `development-docs/`, or `feature-requests/`.

## Project Overview

Discogs Manager is a TypeScript CLI tool that syncs a user's Discogs vinyl collection to a local SQLite database and creates SoundCloud playlists from filtered subsets. It uses Commander.js for CLI parsing and better-sqlite3 for persistence.

## Common Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run dev            # Run via ts-node: npm run dev -- <command> [options]
npm test               # Run all tests (Jest)
npm test -- --testPathPattern=track-matcher   # Run a single test file
npm test -- --watch    # Watch mode
npm run lint           # ESLint on src/
```

The CLI binary is `discogs-cli`. During development use `npm run dev -- <subcommand>`, e.g.:
```bash
npm run dev -- collection sync --force
npm run dev -- collection list --genres "Jazz" --limit 20
npm run dev -- playlist create --title "My Playlist" --genres "Rock"
npm run dev -- soundcloud auth   # SoundCloud OAuth flow
npm run dev -- collection retry  # Process failed-release retry queue
```

## Architecture

Layered architecture with dependency injection — clients and database are constructed in `src/index.ts` and passed down through constructors. See [ADR-0001](adr/ADR-0001-layered-architecture.md).

```
index.ts (bootstrap, wiring)
  → commands/ (CLI parsing, user I/O, spinners)
    → services/ (business logic, orchestration)
      → api/ (HTTP clients for Discogs + SoundCloud)
      → database (SQLite via better-sqlite3)
```

**Key boundaries:**
- **Commands** (`src/commands/`) use `CommandBuilder` utility for consistent spinner/error handling. Each exports a `create*Command()` factory that receives injected dependencies.
- **Services** (`src/services/`) contain all business logic. `CollectionService` handles sync/filter/stats. `PlaylistService` and `playlist-batch.ts` handle SoundCloud playlist CRUD. `TrackMatcher`/`TrackSearch` handle fuzzy matching of Discogs releases to SoundCloud tracks.
- **API clients** (`src/api/`) wrap Discogs and SoundCloud REST APIs with axios. Rate limiting for SoundCloud is in `services/soundcloud-rate-limit.ts`.
- **Resilience utilities** (`src/services/`): `circuit-breaker.ts`, `sync-checkpoint.ts`, `timeout-handler.ts`.

**Data flow:** Discogs API → sync to SQLite → filter/query from SQLite → match tracks on SoundCloud → create/update playlist via SoundCloud API.

## Environment Configuration

Requires a `.env` file (see `.env.example`):
- `DISCOGS_API_TOKEN` and `DISCOGS_USERNAME` — required for all commands
- `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, `SOUNDCLOUD_REDIRECT_URI` — for OAuth
- `SOUNDCLOUD_ACCESS_TOKEN` — optional; if absent, playlist commands lazy-load token from DB
- `ENCRYPTION_KEY` — 64-char hex string for encrypting OAuth tokens at rest in SQLite
- `DB_PATH` — defaults to `./data/discogs-manager.db`

## Testing

Tests live in `tests/` (not co-located with source). Jest config uses `ts-jest` preset. Test files follow `*.test.ts` naming. Fixtures are in `tests/fixtures/`.

## Types

All shared types are in `src/types/index.ts` (Discogs releases, SoundCloud tracks, filter options, etc.).
