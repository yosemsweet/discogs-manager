# ADR-0005: Playlist Track Limit (500-cap) and Automatic Token Refresh

**Date:** 2026-04-05  
**Status:** Accepted

## Context

Two bugs were identified when building large playlists:

1. **401 errors during long track matching**: `SoundCloudAPIClient` baked the access token at construction time with no refresh path. Long-running commands (959 tracks takes ~15 min) triggered token expiry mid-run.

2. **Invalid request on playlists > 500 tracks**: SoundCloud hard-caps playlists at 500 tracks. The previous `PlaylistBatchManager` accumulated PUT payloads incrementally, causing a 400 error when the accumulation exceeded 500.

## Decisions

### Fix 1 — Retry-on-401 with refresh serialization

`SoundCloudAPIClient` now accepts an optional third constructor argument `oauthService?: SoundCloudOAuthService`. When provided, an Axios response interceptor catches 401 responses, calls `oauthService.getValidAccessToken()` once, updates the token, and retries the original request.

A `refreshPromise` guard ensures concurrent 401s from parallel requests share a single refresh call rather than racing on the underlying refresh token.

Without `oauthService` (e.g., token provided via `SOUNDCLOUD_ACCESS_TOKEN` env var), the existing 401-throws-immediately behavior is preserved — no regression.

The `oauthService` is wired in `src/commands/playlist.ts`'s lazy-load block, which already creates both the service and the initial token.

### Fix 2 — Hard 500-track cap with confidence-first sorting

**Single playlist per title, never more than 500 tracks.** When matched tracks exceed the limit:

1. All matched tracks are sorted by confidence descending (tie-broken by release `addedAt` descending — newest acquisition wins).
2. Top N (default 500, configurable via `--limit`, max 500) are sent to SoundCloud.
3. The remaining tracks are stored in a new `excluded_tracks` SQLite table with their confidence scores.

On `playlist update`, the full sort/slice is re-run over all candidates (existing + new), so tracks can be promoted or demoted between included and excluded.

`PlaylistBatchManager.addTracksInBatches` is simplified to a single PUT — no incremental accumulation — since the payload is always ≤ 500.

### CSV curation (Option 2)

A `--from-csv` flag on `playlist create` and `playlist update` allows manual curation: `playlist export` now includes an `include` column (`yes`/`no`/blank). Users can edit the CSV and re-import it. `--from-csv` is mutually exclusive with filter flags.

## Consequences

- Playlists with > 500 matched tracks will only include the top 500 by confidence. Users can view excluded tracks with `playlist tracks excluded --title "..."`.
- Token refresh is automatic during long commands; users no longer need to re-authenticate if a run takes > 1 hour.
- `PlaylistBatchManager` no longer accumulates payload across multiple PUTs — simpler, faster, less error-prone.
- DB migration v6 adds the `excluded_tracks` table to existing databases.
