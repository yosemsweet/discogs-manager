# Playlist Management System

**ADRs:** [ADR-0001](../../../adr/ADR-0001-layered-architecture.md) · [ADR-0003](../../../adr/ADR-0003-track-matching-strategy.md)

Creates, updates, and deletes SoundCloud playlists from filtered subsets of the local Discogs collection. Playlists are capped at 500 tracks (SoundCloud limit). Tracks beyond the limit are stored locally in `excluded_tracks` and can be reviewed.

---

## Usage

```bash
# Create or update a playlist
npm run dev -- playlist create --title "My Jazz" --genres "Jazz"
npm run dev -- playlist update --title "My Jazz" --acquired-after 2026-02-01
npm run dev -- playlist create --title "My Jazz" --limit 200    # cap at 200 tracks
npm run dev -- playlist create --title "My Jazz" --verbose      # debug-level logging

# Import from a CSV file (Option 2: manual curation)
npm run dev -- playlist export --title "My Jazz" --out my-jazz.csv   # export first
# (edit CSV, set include=yes/no on tracks)
npm run dev -- playlist create --title "My Jazz" --from-csv my-jazz.csv
npm run dev -- playlist update --title "My Jazz" --from-csv my-jazz.csv

# Review and resolve unmatched tracks
npm run dev -- playlist tracks review --title "My Jazz"
npm run dev -- playlist tracks unmatched --title "My Jazz"
npm run dev -- playlist tracks reset --title "My Jazz"

# View tracks excluded due to the 500-track limit
npm run dev -- playlist tracks excluded --title "My Jazz"
npm run dev -- playlist tracks excluded --title "My Jazz" --json

# Export playlist track matches to CSV
npm run dev -- playlist export --title "My Jazz"                    # stdout
npm run dev -- playlist export --title "My Jazz" --out ./my-jazz.csv

# Delete a playlist
npm run dev -- playlist delete --title "My Jazz"
npm run dev -- playlist delete --title "My Jazz" --keep-remote   # local data only

# Reverse lookup: find the Discogs track and playlists for a SoundCloud URL
npm run dev -- track lookup https://soundcloud.com/artist/track-name
```

---

## Create/Update Flow

```
playlist create / playlist update command
  → PlaylistService.createPlaylist()
      1. Filter releases from DB via CollectionService.filterReleases()
      2. TrackSearchService.searchTracksForReleases()   ← returns {trackId, discogsId, confidence}
          → Playlist preflight (multi-track releases)
          → Per-track fallback (see Track Matching system)
      3. Sort all matched tracks: confidence DESC, addedAt DESC (tie-break)
      4. Slice top N (default N=500, configurable via --limit, max 500)
      5. Save excluded tracks to excluded_tracks table
      6. POST to SoundCloud (create) or PUT (update) with included track list
      7. Save playlist + track mappings to DB
      8. Report: matched / excluded / unmatched counts
```

**SoundCloud 500-track cap:** No playlist ever exceeds 500 tracks. Tracks beyond the limit are stored in `excluded_tracks` with their confidence scores. On `playlist update`, all tracks are re-sorted and the best N are included — previously excluded tracks may be promoted, and previously included tracks may be excluded.

**Token auto-refresh:** If a request returns 401 during long track matching, `SoundCloudAPIClient` automatically calls `SoundCloudOAuthService.getValidAccessToken()` once and retries. Concurrent 401s share a single refresh call (serialized via `refreshPromise`) to avoid racing on the refresh token.

---

## --from-csv (CSV-driven curation)

```
playlist create --title "X" --from-csv tracks.csv
  1. Parse CSV exported by `playlist export`
  2. Read rows where include=yes and status=matched → included track IDs
  3. Read rows where include=no and status=matched → excluded_tracks
  4. Validate: if >500 include=yes rows → error
  5. Resolve track IDs from soundcloud_url column (DB lookup, then API fallback)
  6. Create or update SoundCloud playlist with resolved IDs
```

`--from-csv` is mutually exclusive with filter flags (`--genres`, `--styles`, etc.).

---

## Review Flow

Unmatched tracks (confidence < 0.6) are stored in the `unmatched_tracks` table with up to 3 near-miss candidates. The review command presents each unmatched track and lets the user:

1. Accept a near-miss candidate
2. Provide a SoundCloud URL (resolved via `/resolve` API endpoint — never regex)
3. Skip the track

After resolving tracks, the playlist is updated with a full PUT including all previously matched + newly resolved tracks.

---

## Delete Flow

```
playlist delete command
  → database.deletePlaylistData(title)
      1. Find playlist by title
      2. Delete playlist_releases (track mappings)
      3. Delete track_matches ONLY for releases not in any other playlist
      4. Delete unmatched_tracks for this playlist
      5. Delete excluded_tracks for this playlist
      6. Delete playlist record
  → SoundCloudAPIClient.deletePlaylist() (unless --keep-remote)
```

---

## Export Flow

```
playlist export command
  → generatePlaylistCsv(db, title)
      1. Look up playlist by title in DB
      2. Query playlist_releases JOIN track_matches → matched+included rows (include=yes)
      3. Query excluded_tracks → excluded rows (include=no)
      4. Query unmatched_tracks → unmatched rows (include=blank)
      5. Build RFC-4180 CSV (matched first, excluded next, then unmatched)
      6. Write to --out path or stdout
```

**No SoundCloud API calls are made** — the export reads entirely from the local database.

CSV columns: `discogs_artist`, `discogs_release`, `discogs_track`, `soundcloud_track`, `soundcloud_url`, `confidence`, `status`, `include`

The `include` column is pre-filled: `yes` for included tracks, `no` for excluded tracks, blank for unmatched.

---

## Reverse Lookup Flow

```
track lookup command
  → SoundCloudAPIClient.resolveUrl(url)   ← always via /resolve, never regex
      → track ID
  → DatabaseManager.getTrackLookupData(trackId)
      → Discogs track title, artist, release title, release ID
      → All playlist titles containing the track
  → Print plain-text output
```

---

## Key Files

| File | Responsibility |
|------|---------------|
| `src/commands/playlist.ts` | `playlist` CLI: `create`, `update`, `delete`, `export`, `tracks` group |
| `src/commands/review.ts` | `playlist tracks review`, `unmatched`, `reset`, `delete`, `excluded` |
| `src/commands/export.ts` | `playlist export` — CSV generation and `--from-csv` import parsing |
| `src/commands/lookup.ts` | `track lookup` — reverse SoundCloud URL lookup |
| `src/commands/track.ts` | `track` command group |
| `src/services/playlist.ts` | `PlaylistService` — create/update orchestration with limit enforcement |
| `src/services/playlist-batch.ts` | `PlaylistBatchManager` — single PUT (≤500 tracks) |
| `src/services/track-search.ts` | Track matching orchestration (returns confidence per track) |
| `src/api/soundcloud.ts` | SoundCloud REST API client (with 401 auto-refresh interceptor) |

---

## Database Tables

- **`playlists`** — `id`, `title`, `soundcloudId`, `createdAt`, `updatedAt`
- **`playlist_releases`** — `playlistId`, `releaseId`, `soundcloudTrackId` (PK on all three — multiple tracks per release allowed)
- **`track_matches`** — Match cache: `(discogsReleaseId, discogsTrackTitle)` → `soundcloudTrackId` + confidence + `matchedPermalinkUrl`
- **`unmatched_tracks`** — Tracks that failed matching, with near-miss candidates JSON
- **`excluded_tracks`** — Tracks matched but excluded due to the 500-track limit; cleared on `playlist delete`
