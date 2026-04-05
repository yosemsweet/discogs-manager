# Playlist should include all tracks per release, not just one

## Problem

When creating a playlist, the system successfully matches most tracks on SoundCloud (e.g. 284 out of 292 for the "Acquired since Feb 16" playlist), but only 1 track per release ends up in the playlist. A playlist for 34 releases should have ~284 tracks, not 34.

## Root cause

The `playlist_releases` table has a composite primary key of `(playlistId, releaseId)`:

```sql
PRIMARY KEY (playlistId, releaseId)
```

When the playlist service saves matched tracks in a loop (`addReleaseToPlaylist` for each track), each call runs `INSERT OR REPLACE`. Since the PK is `(playlistId, releaseId)`, every new track for the same release **overwrites** the previous one. Only the last matched track per release survives.

## Fix

Change the primary key to `(playlistId, releaseId, soundcloudTrackId)` so multiple tracks per release can coexist. This requires:

1. A database migration (version 4) that recreates the table with the new PK and migrates existing data
2. Updating `addReleaseToPlaylist` to require `soundcloudTrackId` (no longer optional)
3. Updating `getPlaylistTracks` to return all tracks (no code change needed — the query already selects all rows for a playlistId)
4. Updating `updatePlaylist` in `playlist.ts` to correctly detect which tracks are new (currently checks by `discogsId`, but now multiple tracks can share a `discogsId`)

## Success Criteria

1. The `playlist_releases` table supports multiple rows per `(playlistId, releaseId)` — one for each matched SoundCloud track.
2. When creating a new playlist, ALL matched tracks are stored in `playlist_releases` (not just one per release).
3. When updating an existing playlist, only tracks not already in `playlist_releases` are treated as new.
4. The SoundCloud PUT request includes all tracks (existing + new) to avoid wiping the playlist.
5. `getPlaylistTracks` returns all tracks across all releases for a playlist.
6. Existing data is preserved during the migration — previously saved tracks are not lost.
7. `addReleaseToPlaylist` requires `soundcloudTrackId` (not optional) to prevent rows with null track IDs.
8. A playlist created from 34 releases with ~292 total tracks should contain ~284 tracks (the number successfully matched), not 34.

## Tests

### Database migration (`tests/database.test.ts`)
- Migration to version 4 creates the new table with `PRIMARY KEY (playlistId, releaseId, soundcloudTrackId)`
- Existing rows in `playlist_releases` survive the migration
- `soundcloudTrackId` column is `NOT NULL` after migration

### `addReleaseToPlaylist` (`tests/database.test.ts`)
- Can insert multiple tracks for the same `(playlistId, releaseId)` with different `soundcloudTrackId` values
- Inserting the same `(playlistId, releaseId, soundcloudTrackId)` tuple twice does not create duplicates (INSERT OR REPLACE)
- Rejects or handles null `soundcloudTrackId` gracefully

### `getPlaylistTracks` (`tests/database.test.ts`)
- Returns all tracks across multiple releases for a playlist
- Returns multiple tracks for the same release when they exist

### Playlist creation flow (`tests/collection.test.ts` or `tests/playlist.test.ts`)
- When `searchTracksForReleases` returns multiple tracks per release, all tracks are stored in `playlist_releases`
- The SoundCloud playlist is created with all matched track IDs, not just one per release

### Playlist update flow
- Existing tracks from the database are included in the PUT request
- Only genuinely new tracks are searched and added
- Tracks already in `playlist_releases` are not duplicated
