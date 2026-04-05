Whenever a playlist is created or updated, I'd like to have an optional output that lists all the tracks that were matched and those that need review. The format should be a CSV. The intent is to read the CSV to see which tracks need adjusting in the playlist instead of trying to reverse engineer from Soundcloud. The most important part of this is knowing that the discogs track is that a soundcloud track is supposed to match.

To also help with this include a reverse lookup command where I can pass in a track url from soundcloud and the CLI will spit back the track it matches, all playlists it is included in, and a link to the discogs release the track is on.

---

## Feature 1: Playlist CSV Export

### Usage

```bash
npm run dev -- playlist export --title "My Jazz" --out ./my-jazz.csv
npm run dev -- playlist export --title "My Jazz"                        # prints to stdout
npm run dev -- playlist export --title "My Jazz" --out ~/reports/my-jazz.csv
```

### Success Criteria

1. `playlist export` is a new subcommand (alongside `playlist review` and `playlist delete`).
2. `--title <name>` is required and identifies which playlist to export; error if not found in the local database.
3. `--out <filepath>` is optional; when omitted, CSV is printed to stdout.
4. CSV columns (in order): `discogs_artist`, `discogs_release`, `discogs_track`, `soundcloud_track`, `soundcloud_url`, `confidence`, `status`
5. `status` is `matched` for tracks in `playlist_releases` and `unmatched` for tracks in `unmatched_tracks`.
6. For unmatched tracks, `soundcloud_track`, `soundcloud_url`, and `confidence` are empty strings.
7. Rows are sorted: matched tracks first (grouped by release), then unmatched tracks.
8. CSV values containing commas or quotes are correctly escaped per RFC 4180.
9. If `--out` is provided and the parent directory does not exist, the command prints a clear error without writing any file.
10. The command reads entirely from the local database — it does not trigger any SoundCloud API calls.

### Tests (`tests/playlist-export.test.ts`)

#### CSV generation (unit)
- Matched tracks produce correct CSV rows with all fields populated
- Unmatched tracks produce rows with empty `soundcloud_track`, `soundcloud_url`, `confidence`
- Values with commas and double-quotes are properly escaped per RFC 4180
- Rows are sorted: matched first (by release then track title), then unmatched
- Headers are always written even when there are no tracks

#### File output
- When `--out` is provided, CSV is written to the specified path
- When `--out` is omitted, CSV is written to stdout
- Writing to a path whose parent directory does not exist produces a clear error message

#### Database reads
- `--title` not matching any playlist produces a clear "playlist not found" error
- Export reads from `playlist_releases` and `unmatched_tracks`; no SoundCloud API calls are made

---

## Feature 2: Reverse Lookup Command

### Usage

```bash
npm run dev -- lookup https://soundcloud.com/artist/track-name
npm run dev -- lookup "https://soundcloud.com/artist/track?in=artist/sets/album&si=abc123"
```

### Success Criteria

1. `lookup <soundcloud-url>` is a new top-level command.
2. The URL is resolved to a canonical track ID via the SoundCloud `/resolve` API — never via regex extraction.
3. URLs with query parameters (e.g. `?in=...&si=...`) are handled correctly; the query string is not used for ID extraction.
4. Output includes:
   - Discogs track title and artist the track was matched to
   - Discogs release title
   - Discogs release URL (`https://www.discogs.com/release/<discogsId>`)
   - All playlist titles the track appears in (one per line)
5. If the resolved track ID is not found in the local `track_matches` or `playlist_releases` tables, output a clear "Track not found in local database" message (not an error exit).
6. If the URL cannot be resolved (invalid URL, SoundCloud 404, network error), output a clear error message with the reason.
7. If the track is in no playlists, output "Not in any playlists" rather than an empty section.

### Tests (`tests/lookup.test.ts`)

#### URL resolution
- A valid SoundCloud track URL is resolved via the `/resolve` API (not regex)
- A URL with `?in=`, `&si=`, and other query params resolves to the correct track ID (not a set/playlist ID)
- An invalid URL (not SoundCloud domain) produces a clear error message
- A URL that returns 404 from the resolve API produces a clear "not found" error

#### Local database lookup
- A resolved track ID found in `track_matches` returns correct Discogs artist, track title, release title, and release URL
- A resolved track ID found in `playlist_releases` returns the correct playlist title(s)
- A track appearing in multiple playlists lists all of them
- A resolved track ID not present in `track_matches` outputs "Track not found in local database"
- A track matched to a release but not in any playlist outputs "Not in any playlists"

#### Output format
- Output includes the Discogs release URL in the format `https://www.discogs.com/release/<id>`
- Output is readable as plain text (not JSON by default)