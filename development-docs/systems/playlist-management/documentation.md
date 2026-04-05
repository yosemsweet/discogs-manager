# Playlist Management System

**ADRs:** [ADR-0001](../../../adr/ADR-0001-layered-architecture.md) · [ADR-0003](../../../adr/ADR-0003-track-matching-strategy.md)

Creates, updates, and deletes SoundCloud playlists from filtered subsets of the local Discogs collection.

---

## Usage

```bash
# Create or update a playlist
npm run dev -- playlist --title "My Jazz" --genres "Jazz"
npm run dev -- playlist --title "Recent Haul" --acquired-after 2026-02-01
npm run dev -- playlist --title "My Jazz" --verbose   # debug-level logging

# Review and resolve unmatched tracks
npm run dev -- playlist review --title "My Jazz"

# Export playlist track matches to CSV
npm run dev -- playlist export --title "My Jazz"                    # stdout
npm run dev -- playlist export --title "My Jazz" --out ./my-jazz.csv

# Delete a playlist
npm run dev -- playlist delete --title "My Jazz"
npm run dev -- playlist delete --title "My Jazz" --keep-remote   # local data only

# Reverse lookup: find the Discogs track and playlists for a SoundCloud URL
npm run dev -- lookup https://soundcloud.com/artist/track-name
npm run dev -- lookup "https://soundcloud.com/artist/track?in=artist/sets/album&si=abc123"
```

---

## Create/Update Flow

```
playlist command
  → PlaylistService.createOrUpdatePlaylist()
      1. Filter releases from DB via CollectionService.filterReleases()
      2. TrackSearchService.searchTracksForReleases()
          → Playlist preflight (multi-track releases)
          → Per-track fallback (see Track Matching system)
      3. If playlist exists on SoundCloud: PUT (all existing + new tracks)
         If new: POST to create
      4. Save playlist + track mappings to DB
      5. Report: matched / unmatched counts
```

**Important:** SoundCloud playlist updates use PUT with the full track list. Partial updates are not supported — every PUT must include all existing tracks plus any new ones to avoid wiping the playlist.

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
      5. Delete playlist record
  → SoundCloudAPIClient.deletePlaylist() (unless --keep-remote)
```

---

## Export Flow

```
playlist export command
  → generatePlaylistCsv(db, title)
      1. Look up playlist by title in DB
      2. Query playlist_releases JOIN track_matches → matched rows
      3. Query unmatched_tracks → unmatched rows
      4. Build RFC-4180 CSV (matched first, then unmatched)
      5. Write to --out path or stdout
```

**No SoundCloud API calls are made** — the export reads entirely from the local database.

CSV columns: `discogs_artist`, `discogs_release`, `discogs_track`, `soundcloud_track`, `soundcloud_url`, `confidence`, `status`

---

## Reverse Lookup Flow

```
lookup command
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
| `src/commands/playlist.ts` | `playlist` CLI and subcommand registration |
| `src/commands/review.ts` | `playlist review`, `playlist delete`, etc. |
| `src/commands/export.ts` | `playlist export` — CSV generation |
| `src/commands/lookup.ts` | `lookup` — reverse SoundCloud URL lookup |
| `src/services/playlist.ts` | `PlaylistService` — create/update orchestration |
| `src/services/playlist-batch.ts` | `PlaylistBatchManager` — chunked SoundCloud API calls |
| `src/services/track-search.ts` | Track matching orchestration |
| `src/api/soundcloud.ts` | SoundCloud REST API client |

---

## Database Tables

- **`playlists`** — `id`, `title`, `soundcloudId`, `createdAt`, `updatedAt`
- **`playlist_releases`** — `playlistId`, `releaseId`, `soundcloudTrackId` (PK on all three — multiple tracks per release allowed)
- **`track_matches`** — Match cache: `(discogsReleaseId, discogsTrackTitle)` → `soundcloudTrackId` + confidence
- **`unmatched_tracks`** — Tracks that failed matching, with near-miss candidates JSON
