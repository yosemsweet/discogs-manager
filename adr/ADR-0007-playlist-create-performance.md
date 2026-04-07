# ADR-0007: Playlist-create performance: bulk cache, concurrency, negative cache, strategy pruning

**Status:** Accepted

## Context

`playlist create` with 500 unmatched tracks took 15–30 minutes. The dominant costs were:

1. **Per-track SQL cache lookups** — one `getCachedTrackMatch` call per track inside a sequential loop instead of one bulk query.
2. **Sequential per-release processing** — releases were processed one at a time; SoundCloud network latency (not rate limit) was the ceiling on the search path.
3. **Repeated fruitless searches** — tracks that failed on a previous run were re-searched on every subsequent run, paying the full 4-strategy cost again.
4. **No feedback on strategy effectiveness** — all 4 fallback strategies ran regardless of their historical hit rates.

## Decision

Four targeted changes to `TrackSearchService.searchTracksForReleases` and `DatabaseManager`, listed in implementation order:

### 1. Bulk cache pre-fetch
Before the per-release loop, load all `track_matches` rows for the candidate release set with a single `SELECT … WHERE discogsReleaseId IN (…)` query into an in-memory `Map<"releaseId|trackTitle", CachedMatch>`. Per-track lookups are O(1) map hits. `getCachedTrackMatch` is never called in the hot loop.

### 2. Bounded concurrency (`runWithConcurrency`)
Replace the sequential `for (const release of releases)` loop with `runWithConcurrency(releases, limit, fn)` — a purpose-built helper in `src/utils/concurrency.ts` that keeps at most `limit` releases in flight at once and returns results in input order. Default concurrency: **8**. Exposed via `--concurrency <n>` on `playlist create/update`.

The existing `SoundCloudRateLimitService.throttleIfApproachingLimit()` continues to gate all requests at the API level, so concurrency beyond the daily budget is automatically capped. The `ConcurrencyManager` class already in `concurrency.ts` was not used here because it is built on priority queues and polling (`setInterval`), which is unnecessary complexity for a simple bounded-concurrency fan-out.

### 3. Negative-match cache
`DatabaseManager.isKnownUnmatchedTrack(releaseId, trackTitle, ttlDays)` checks `unmatched_tracks` for a 'pending' row newer than the TTL (default 30 days). When found, `searchWithFallback` returns `null` immediately — no SoundCloud calls. Pass `--exhaustive` to bypass. On cache miss, the track is still saved to `unmatched_tracks` as before.

### 4. Strategy stats and pruning
A new `match_strategy_stats` table (schema migration v7) records `(strategyIndex, attempts, hits)` for every search attempt. Before running strategy i, the service skips it if `attempts ≥ 100 AND hits/attempts < 0.05`. The in-memory stats map is updated within the session so pruning improves as the run progresses. Pass `--exhaustive` to bypass. The table accumulates data passively; pruning activates automatically once enough observations exist.

## Consequences

- **Expected speedup (typical warm-cache large playlist):** 15–30 min → 1–3 min.
- **Expected speedup (cold 500-track build):** 15–30 min → 3–5 min.
- **Re-run of a partially failed build:** 15–30 min → 30 sec – 2 min (negative cache skips known-dead tracks).
- `playlist create` and `playlist update` accept `--concurrency <n>` and `--exhaustive`.
- `match_strategy_stats` table ships empty; pruning has no effect until ≥ 100 observations accumulate per strategy on a given installation.
- Sync speed is unchanged (out of scope; this change targets the playlist-create hot path).
