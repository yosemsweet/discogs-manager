# Collection Sync System

**ADR:** [ADR-0001](../../../adr/ADR-0001-layered-architecture.md)

Fetches a user's Discogs vinyl collection via the Discogs API and stores releases, tracklists, and metadata in the local SQLite database.

---

## Usage

```bash
npm run dev -- collection sync              # Incremental sync (skips already-synced releases)
npm run dev -- collection sync --force      # Full re-sync (re-fetches all releases)
```

---

## Flow

```
sync command
  → CollectionService.syncCollection()
      1. Fetch release IDs from Discogs /users/{username}/collection
      2. For each release not yet in DB (or --force):
          a. Fetch release details (title, year, artists, labels, genres, styles)
          b. Fetch tracklist (title, position, duration, artists)
          c. Save to releases + tracks tables
      3. Report: added / updated / failed counts
```

Releases that fail to fetch are added to a retry queue (`retry_queue` table) and can be retried with `npm run dev -- collection retry`.

---

## Key Files

| File | Responsibility |
|------|---------------|
| `src/commands/sync.ts` | CLI interface, progress display |
| `src/services/collection.ts` | `syncCollection()`, `filterReleases()` |
| `src/api/discogs.ts` | Discogs REST API client |
| `src/services/database.ts` | `saveRelease()`, `saveTrack()`, schema |

---

## Database Tables

- **`releases`** — One row per Discogs release: `discogsId`, `title`, `artists`, `labels`, `genres`, `styles`, `year`, `rating`, `addedAt`
- **`tracks`** — One row per track: `discogsReleaseId`, `title`, `position`, `duration`, `artists`
- **`retry_queue`** — Failed releases pending re-sync

---

## Filtering

`CollectionService.filterReleases()` accepts a `PlaylistFilter` to narrow the collection for playlist creation:

| Filter | Option |
|--------|--------|
| Genres | `--genres "Jazz,Rock"` |
| Styles | `--styles "Hard Bop"` |
| Artists | `--artists "Miles Davis"` |
| Labels | `--labels "Blue Note"` |
| Year range | `--min-year 1960 --max-year 1969` |
| Date acquired | `--acquired-after 2026-01-01 --acquired-before 2026-03-01` |
| Min rating | `--min-rating 4` |

All filters are OR within a field, AND across fields.
