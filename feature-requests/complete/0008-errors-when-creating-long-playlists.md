I've been trying to create a large playlist with two styles:
`npm run dev -- playlist update  --title "my nu-wave music" --styles "New Wave,Synth-pop"`

I've run the command a couple times now and everytime I get errors. There are two major errors:

**401s when matching tracks**
If the process of track matching takes a long time I eventually get a bunch of 401 errors when matching tracks. My guess is that this is due to the soundcloud auth token expiring and not getting refreshed within the scope of a single command.

**playlist creation with a very long playlist is an invalid request**
When creating a playlist with the matched tracks I get following error:
```
[10:57:24 AM] [INFO ] Track matching complete: 959/1431 tracks matched (67.0%)
⠋ Adding tracks to playlist: 600/959 - Batch 6/10[10:57:32 AM] [ERROR] [addTracksToPlaylist(2217489092, 600 tracks)] Invalid request
✖ ✗ Failed to create playlist: Failed to create playlist: AppError: Invalid request
```

This is most likely due to a soundcloud limit of 500 tracks in a playlist as per https://help.soundcloud.com/hc/en-us/articles/360005673974-Playlist-Limits

Come up with a plan for resolving these two issues in a way that still allows me to create and manage large playlists with a single command. Write up your plan in this file under "Proposed Approach", include Success Criteria and list all tests needed to ensure the system works.

---

## Proposed Approach

### Fix 1 — Retry-on-401 with refresh serialization in `SoundCloudAPIClient`

**Root cause:** `SoundCloudAPIClient` accepts an `accessToken: string` at construction time and bakes it into the Axios instance's `Authorization` header. There is no path back to `SoundCloudOAuthService`, so the token is never refreshed even when the service's `getValidAccessToken()` would do so automatically.

**Fix:** Accept an optional `oauthService` parameter and install an Axios **response** interceptor that catches 401 errors, refreshes the token exactly once, and retries the original request. A serialization guard ensures concurrent 401s don't trigger parallel refresh races.

```typescript
// New constructor signature — backwards compatible
constructor(
  accessToken: string,
  rateLimitService?: SoundCloudRateLimitService,
  oauthService?: SoundCloudOAuthService   // optional; enables auto-refresh
)
```

The response interceptor with serialization guard:
```typescript
private refreshPromise: Promise<string> | null = null;

this.client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retried && this.oauthService) {
      originalRequest._retried = true;

      // Serialize concurrent refreshes: if a refresh is already in flight, await it
      // instead of triggering a second one (which would race on the refresh token).
      if (!this.refreshPromise) {
        this.refreshPromise = this.oauthService.getValidAccessToken().finally(() => {
          this.refreshPromise = null;
        });
      }
      const newToken = await this.refreshPromise;

      this.accessToken = newToken;
      this.client.defaults.headers['Authorization'] = `OAuth ${newToken}`;
      originalRequest.headers['Authorization'] = `OAuth ${newToken}`;
      return this.client(originalRequest);
    }
    // If retry also 401'd, or no oauthService — reject normally.
    // The error flows into the per-method catch → handleError path as before.
    return Promise.reject(error);
  }
);
```

**Wiring — two paths:**

1. **`SOUNDCLOUD_ACCESS_TOKEN` env var set (rare):** `index.ts` constructs `SoundCloudAPIClient(token)` with no `oauthService`. 401s are thrown immediately (current behaviour, no regression).

2. **Token loaded from DB (common path):** In `src/commands/playlist.ts`'s lazy-load block (line 115–138), the code already constructs `oauthService` and calls `oauthService.getValidAccessToken()` to get the initial token. After that, it constructs `SoundCloudAPIClient(token, rateLimitService)`. The fix: pass `oauthService` as the third argument here:
   ```typescript
   clientToUse = new SoundCloudAPIClient(token, rateLimitService, oauthService);
   ```
   No changes to `index.ts` needed — the lazy-load path is the one that matters.

**Error flow after failed retry:** If the retried request also returns 401, the interceptor does *not* catch it (because `_retried` is already `true`). The rejection propagates through Axios to the per-method `catch` block, which calls `handleError` — producing the same `AppError` the user would see today. No special handling needed.

---

### Fix 2 — Hard cap at 500 tracks per playlist

**Root cause:** SoundCloud caps playlists at 500 tracks. `PlaylistBatchManager` currently sends accumulating PUT payloads, so once the accumulated total exceeds 500 SoundCloud rejects the request.

**Fix:** Enforce a `SOUNDCLOUD_PLAYLIST_TRACK_LIMIT = 500` constant. When matched tracks exceed the limit, the top 500 (by a configurable priority) are added to the playlist and the remainder are stored locally as "excluded" tracks that can be viewed via `playlist tracks excluded`.

No multi-part playlists, no DB schema changes for playlist splitting. One SoundCloud playlist per title.

#### New CLI options

Add to `playlist create` and `playlist update`:

- `--limit <n>` — Maximum tracks to include (default: 500, max: 500). Allows users to set a lower cap if desired.

The priority/sort strategy is determined separately — see "Prioritization Approaches" below.

#### Changes to `PlaylistBatchManager`

- `addTracksInBatches` hard-caps the accumulated payload at 500. Since SoundCloud accepts 500 tracks in a single PUT, the batch logic is simplified: send one PUT with the full track list (no more incremental accumulation of 100/200/300/...).
- `createPlaylistWithBatching` uses `createPlaylistWithTracks` for ≤ 500 tracks (single request). The multi-batch fallback is removed — it's no longer possible to exceed 500.

#### Changes to `PlaylistService`

- After track matching, sort all matched tracks by the chosen priority, take the top `limit` (default 500), and send those to SoundCloud.
- Tracks beyond the limit are saved to a new `excluded_tracks` table:
  ```sql
  CREATE TABLE IF NOT EXISTS excluded_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlistTitle TEXT NOT NULL,
    discogsReleaseId INTEGER NOT NULL,
    discogsTrackTitle TEXT NOT NULL,
    soundcloudTrackId TEXT NOT NULL,
    confidence REAL,
    reason TEXT NOT NULL DEFAULT 'limit_exceeded',
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```
- On `playlist update`, excluded tracks are re-evaluated: a previously-excluded track may now rank in the top 500, and a previously-included track may drop out.

#### New subcommand: `playlist tracks excluded`

```bash
npm run dev -- playlist tracks excluded --title "My Jazz" [--json]
```

Shows tracks that were matched but excluded from the SoundCloud playlist due to the 500-track limit. Includes the track title, artist, confidence score, and why it was excluded.

#### User-visible output

```
✔ Created "My Nu-Wave Music" — 500/959 matched tracks added
  459 tracks excluded (playlist limit: 500)
  Run: playlist tracks excluded --title "My Nu-Wave Music" to view excluded tracks
```

#### `BATCH_SIZE` simplification

Since playlists are now capped at 500, `addTracksInBatches` no longer needs incremental accumulation. The SoundCloud API accepts a single PUT with up to 500 tracks, so the method sends one request with the full track list. The `BATCH_SIZE = 100` incremental logic is removed.

---

## Prioritization Approaches

**Decision needed:** When more than 500 tracks match, which 500 go into the playlist? Two options:

### Option 1 — Confidence-first (automatic)

Sort all matched tracks by descending `confidence` score (the fuzzy match score from track matching). Top 500 go into the playlist. This is the default behaviour — no extra flags needed.

**Tie-breaking:** When confidence scores are equal, sort by Discogs release `addedAt` descending (newest acquisitions first).

**Pros:**
- Maximizes playlist quality — low-confidence matches (which may be wrong tracks) are excluded first.
- Zero-friction default: just run `playlist create` and the best matches are included.
- No new CLI flags needed.

**Cons:**
- Does not respect any musical ordering (genre, era, artist).
- A great album with a poor SoundCloud match is excluded over a mediocre album with a perfect match.
- No manual control over which specific tracks are included or excluded.

### Option 2 — CSV-driven manual curation

Export a CSV of all matched tracks with an `include` column, let the user edit it, then import it back to drive which tracks go into the playlist.

**Workflow:**
```bash
# 1. Export all matched tracks to CSV (with include column pre-filled)
npm run dev -- playlist export --title "My Nu-Wave Music" --out tracks.csv

# 2. User edits tracks.csv — sets include=no on tracks they don't want,
#    sets include=yes on tracks they do want (up to 500 yes values)

# 3. Import the edited CSV to update the playlist
npm run dev -- playlist create --title "My Nu-Wave Music" --from-csv tracks.csv
npm run dev -- playlist update --title "My Nu-Wave Music" --from-csv tracks.csv
```

**CSV format** — the export CSV (which already exists) gains a new `include` column:
```
discogs_artist,discogs_release,discogs_track,soundcloud_track,soundcloud_url,confidence,status,include
Miles Davis,Bitches Brew,Miles Runs the Voodoo Down,Miles Runs the Voodoo Down,https://soundcloud.com/...,0.92,matched,yes
Miles Davis,Bitches Brew,Pharaoh's Dance,Pharaohs Dance,https://soundcloud.com/...,0.71,matched,yes
...
```

On initial export, the `include` column is pre-filled: `yes` for the top 500 by confidence, `no` for the rest. Unmatched tracks have `include` blank (they can't be included regardless).

**`--from-csv` behaviour:**
- Reads the CSV, extracts `soundcloud_url` and `include` columns.
- Only rows with `include=yes` and `status=matched` are sent to SoundCloud.
- If more than 500 rows have `include=yes`, the command errors with a clear message.
- Rows with `include=no` are saved to `excluded_tracks` as before.
- The user can re-export, edit, and re-import as many times as they want.

**Pros:**
- Full manual control: the user decides exactly which tracks make the cut.
- Works with any external tool (Excel, Google Sheets, text editor, scripts).
- The CSV is already a feature — this extends it naturally.
- Can be combined with Option 1: use confidence as the default, override with CSV when needed.

**Cons:**
- Multi-step workflow — not a single command for the first run.
- Requires the user to edit a potentially large file (959 rows).
- More code: CSV parsing/validation on import, `--from-csv` flag, error handling for malformed CSVs.

---

## Success Criteria

### Fix 1 — Token refresh

1. `SoundCloudAPIClient` accepts an optional `oauthService: SoundCloudOAuthService` as a third constructor argument.
2. When `oauthService` is provided and a request receives a 401, the client calls `oauthService.getValidAccessToken()`, updates its stored token, and retries the original request exactly once.
3. A second consecutive 401 on the retried request is not swallowed — it is thrown as an error (no infinite loop). The error flows through the existing `handleError` path.
4. When `oauthService` is not provided, a 401 is thrown immediately (no change to existing behaviour).
5. In `src/commands/playlist.ts`'s lazy-load block, the `SoundCloudAPIClient` is constructed with the `oauthService` that was already created for the initial token fetch.
6. No extra HTTP calls are made on successful requests (the interceptor only fires on 401 responses).
7. Concurrent 401s from parallel requests share a single refresh call (serialization guard prevents race conditions on the refresh token).
8. Existing unit tests that construct `SoundCloudAPIClient` with only a token string continue to pass without modification.

### Fix 2 — Playlist track limit

1. `SOUNDCLOUD_PLAYLIST_TRACK_LIMIT = 500` is enforced: no playlist ever exceeds 500 tracks.
2. `playlist create` with > 500 matched tracks adds the top 500 (by priority) and stores the rest as excluded.
3. `playlist update` re-evaluates priority and may swap tracks between included/excluded.
4. `playlist tracks excluded --title "X"` displays excluded tracks with their confidence score and reason.
5. `--limit <n>` on `playlist create/update` allows a lower cap (default: 500, max: 500).
6. `playlist delete` clears excluded tracks for the given title.
7. `playlist export` includes only the tracks actually in the SoundCloud playlist (not excluded tracks).
8. `addTracksInBatches` sends a single PUT with all tracks (no incremental accumulation), since the payload is always ≤ 500.
9. One SoundCloud playlist per title — no multi-part playlists, no schema changes to the `playlists` table.
10. Output clearly reports how many tracks were included vs excluded, and tells the user how to view excluded tracks.

---

## Tests Needed

### Fix 1 — Token refresh (`tests/soundcloud-api-token-refresh.test.ts`)

- A successful request (2xx) does not trigger `oauthService.getValidAccessToken()`.
- A 401 response with `oauthService` provided triggers `getValidAccessToken()` exactly once and retries the request with the new token.
- If the retried request also returns 401, the error is thrown (no further retry) and flows through `handleError`.
- Constructing without `oauthService`: a 401 is thrown immediately without attempting a refresh.
- After a successful retry, `this.accessToken` and the Axios default header are updated to the new token; subsequent requests use the refreshed token.
- Concurrent 401s: two simultaneous 401 responses result in only one call to `getValidAccessToken()`, not two (serialization guard).
- After the shared refresh resolves, both retried requests use the same refreshed token.
- If `getValidAccessToken()` itself throws (e.g., refresh token revoked), the error is propagated clearly — not swallowed.
- Regression: existing `SoundCloudAPIClient` tests that pass only a token string continue to pass.

### Fix 2 — Track limit enforcement (`tests/playlist-track-limit.test.ts`)

- With 300 matched tracks (under limit): all 300 are sent to SoundCloud, no excluded tracks saved.
- With 500 matched tracks (at limit): all 500 are sent, no excluded tracks saved.
- With 501 matched tracks: 500 sent to SoundCloud, 1 saved as excluded.
- With 959 matched tracks: 500 sent, 459 saved as excluded.
- `--limit 200` with 500 matched tracks: 200 sent, 300 excluded.
- `--limit 0` or `--limit -1` produces a validation error.
- `--limit 501` produces a validation error (exceeds SoundCloud cap).

### Fix 2 — Priority sorting (`tests/playlist-track-priority.test.ts`)

Tests for whichever prioritization approach is chosen:

**If Option 1 (confidence-first):**
- Tracks sorted by descending confidence; highest-confidence tracks are included.
- Ties broken by descending `addedAt` (newest acquisition first).
- Deterministic: same input always produces same ordering.

**If Option 2 (CSV-driven) — additional tests (`tests/playlist-csv-import.test.ts`):**
- `--from-csv` reads a CSV and includes only rows where `include=yes` and `status=matched`.
- `--from-csv` with > 500 `include=yes` rows produces a validation error with a clear message.
- `--from-csv` with `include=yes` on an `unmatched` row ignores that row (cannot include unmatched tracks).
- `--from-csv` with a malformed CSV (missing columns, bad encoding) produces a clear error.
- `--from-csv` with a CSV referencing a track not in the database produces a warning per track, not a hard failure.
- `playlist export` output includes the `include` column: `yes` for included tracks, `no` for excluded, blank for unmatched.
- Round-trip: export → no edits → import produces the same playlist (idempotent).
- `--from-csv` and filter flags (`--genres`, `--styles`, etc.) are mutually exclusive — error if both provided.

### Fix 2 — `playlist update` re-evaluation

- Track previously excluded (confidence 0.61) is now included after a higher-confidence track is removed from the collection.
- Track previously included (confidence 0.65) is excluded when a new track with confidence 0.90 is matched.
- Re-evaluation preserves the same priority order on every update (deterministic).

### Fix 2 — `playlist tracks excluded` subcommand

- Outputs excluded tracks with artist, title, confidence, and reason.
- `--json` outputs JSON array.
- Returns empty list when no tracks are excluded.
- Returns empty list when playlist does not exist (with appropriate message).

### Fix 2 — Batch simplification

- `addTracksInBatches` with ≤ 500 tracks calls `addTracksToPlaylist` exactly once (single PUT).
- `addTracksInBatches` is never called with > 500 tracks (enforced upstream).
- Progress callback is called with final count.

### Fix 2 — Database (`tests/database.test.ts` additions)

- `saveExcludedTracks(title, tracks)` writes to `excluded_tracks` table.
- `getExcludedTracks(title)` returns all excluded tracks for a playlist.
- `deleteExcludedTracks(title)` removes excluded tracks when playlist is deleted.
- `deletePlaylistData(title)` also clears `excluded_tracks` for that title.
- Migration v6 creates `excluded_tracks` table on existing databases without error.
- Fresh DB has `excluded_tracks` table from the start.
