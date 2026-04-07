# Speed up long-running tasks (sync, playlist create/update)

Syncing data and creating playlists with hundreds of tracks takes a really long time. Below are three different approaches to speed up the slow paths — `collection sync` (slow due to per-release Discogs fetches) and `playlist create/update` (slow due to per-track SoundCloud searches with multiple fallback strategies).

## Where the time currently goes

Baseline measurements assume an authenticated Discogs account (60 req/min cap) and SoundCloud's 15,000 req/24h budget (no enforced per-second cap, but the codebase throttles when the daily window gets thin).

**`collection sync` of 500 records (cold, no cache):**
- `getCollectionPaginated` → 10 paginated calls (1 page = 50 releases). ~5-10 seconds total.
- `getRelease()` → **500 sequential calls**, one per release. At the 60/min cap this is the floor: 500 / 60 ≈ **8.3 minutes minimum**, real-world **~10-15 minutes** with throttling and per-call latency.
- The collection-list endpoint already returns `basic_information` (title, artists, year, genres, styles). The only thing the per-release call adds is the tracklist — which is *not needed at sync time*, only at playlist-create time.

**`playlist create` for 500 tracks where none are pre-matched (cold cache):**
- For each release, the search service runs *playlist preflight* (2 SoundCloud calls per release: `searchPlaylists` + `getPlaylistTracks`).
- For tracks the playlist preflight didn't resolve, it runs `searchWithFallback` which fires up to **4 query strategies** per track until one returns a confident match. Worst case: 4 searches per unmatched track.
- For each track, `getCachedTrackMatch` is called individually inside the loop instead of being batched.
- 500 tracks × 1-4 searches × ~1-2 s per search ≈ **15-30 minutes**, plus ~1-2 minutes of preflight cost.

These two scenarios are the targets for the success criteria in each approach below.

---

## Approach 1 — Bounded concurrency (worker pool)

### Description

Replace the sequential `for` loops in `CollectionService.syncCollection`, `CollectionService.syncSpecificReleases`, and `TrackSearchService.searchTracksForReleases` with a bounded-concurrency worker pool. Use a small dependency like `p-limit` (or roll a tiny `runWithConcurrency(items, limit, fn)` helper) to fire N requests in flight at once, while the existing rate-limit throttling layer (`SoundCloudAPIClient.throttleIfApproachingLimit` and `DiscogsAPIClient.throttleIfNeeded`) continues to gate at the API level.

Concrete shape:
- **Discogs sync**: concurrency cap of 5. Discogs's 60-req/min rate cap is the real ceiling, so concurrency mostly hides per-call latency rather than multiplying throughput.
- **SoundCloud per-track search**: concurrency cap of 8. SoundCloud doesn't enforce a per-second cap; the daily 15k budget is the only real ceiling. Order of writes to the database (`saveCachedTrackMatch`, `trackData.push`) is preserved by collecting per-task results into a result array indexed by input order.
- Existing `axios-retry` 429 handling remains the safety net for bursts.
- A new `--concurrency <n>` CLI flag exposes the cap so users can dial it down on flaky networks.

### Pros

- **Largest absolute speedup on the playlist-create path**, because SoundCloud latency (not rate limit) is the dominant cost there.
- Code changes are localized to the orchestration layer — `TrackMatcher`, `DatabaseManager`, and the API clients are unchanged.
- Naturally composes with Approach 2 and Approach 3.
- The existing 429-retry path already exists; concurrency just exercises it more often.

### Cons

- **Doesn't help Discogs sync much.** Discogs's 60-req/min cap means the sustainable throughput ceiling is ~1 req/sec regardless of how many workers we run. We get a small win from hiding per-call latency but not a big multiplier.
- More 429s in practice → more retry storms → harder to reason about progress reporting and ETA.
- Checkpointing/cancellation logic in `sync-checkpoint.ts` becomes harder: workers may be mid-flight when a Ctrl-C arrives, and the "next item to resume from" is no longer a simple index.
- Database writes (`better-sqlite3` is synchronous, single-writer) become a contention point. Not a problem at concurrency 5-8, but worth noting.
- Progress UI needs reworking — the current spinners assume a strictly linear "now processing item N of M" model.

### Success criteria

- A `--concurrency` flag exists and defaults to a sensible value (5 for Discogs, 8 for SoundCloud).
- No new 4xx/5xx errors at the default concurrency on a representative 500-release collection.
- Existing tests still pass; new tests cover ordering preservation, partial-failure handling, and cancellation.
- **Sync 500 records: ~10-15 min → ~5-7 min** (~2x). Limited by Discogs's 60/min cap.
- **Playlist create 500 unmatched tracks: ~15-30 min → ~3-5 min** (~5-7x). Limited by how aggressively we can hammer SoundCloud without triggering soft throttling.

### Tests needed

- **Unit: `runWithConcurrency` helper.** Given an array of N async tasks and concurrency cap C, verify (a) at most C tasks are in flight at any time (instrument with a counter), (b) results are returned in input order, (c) a single task throwing does not cancel other in-flight tasks, (d) all errors are surfaced after the pool drains.
- **Unit: ordering preservation in `searchTracksForReleases`.** With a mocked SoundCloud client that returns results in a deliberately reversed order (slow tasks resolve last), the resulting `trackData` array must still be ordered by input `(releaseId, trackIndex)`. Catches the obvious "race conditions reorder the playlist" bug.
- **Unit: rate-limit throttle still gates concurrent workers.** Mock `SoundCloudRateLimitService` to report `isApproachingLimit() === true` after the 3rd call. Run 10 tasks at concurrency 5. Assert that at most 3 calls happened before the throttle wait kicked in, and that all 10 eventually completed.
- **Unit: 429 retry under concurrency.** Mock the SoundCloud client to return 429 on calls 2 and 4 with a `retry-after` header. Verify the worker pool retries those two without blocking the other workers, and the final result set is complete.
- **Integration: Discogs sync at concurrency 5 against a recorded fixture.** Use a 50-release fixture with `nock` or recorded HTTP responses. Verify (a) all 50 releases land in SQLite, (b) elapsed time is meaningfully shorter than the sequential baseline, (c) no duplicate `INSERT`s, (d) cancellation via `AbortController` mid-run leaves the DB in a consistent state.
- **Integration: cancellation mid-run.** Start a sync of 100 releases at concurrency 5. After ~20 complete, fire `AbortSignal.abort()`. Verify in-flight tasks finish or roll back cleanly, no partial release rows, and the retry queue is unchanged.
- **Regression: existing `track-matcher.test.ts` and `playlist.test.ts` must pass unchanged.** Concurrency is an orchestration-layer change; matching logic should be untouched.
- **Performance smoke test (manual, not CI).** Document the wall-clock measurement procedure on a 500-track playlist build so future regressions are detectable. Record baseline pre-change and post-change numbers in the PR description.

---

## Approach 2 — Lazy / deferred fetching (skip work that isn't needed yet)

### Description

The biggest speedup for `sync` comes from *not making the per-release calls at all*. The collection-list endpoint already returns everything `StoredRelease` needs except the tracklist. The tracklist is only used by the playlist-create path, and only for the releases that match the playlist filter.

Concrete shape:
- **Sync (Phase 1, fast path)**: `syncCollection` writes releases from the `getCollectionPaginated` response directly into SQLite. No `getRelease()` calls. Add a `tracklist_loaded INTEGER DEFAULT 0` column on the `releases` table.
- **Sync (Phase 2, on-demand)**: a new `CollectionService.ensureTracklistsLoaded(releaseIds)` method fetches `getRelease()` only for releases that need it, called from `PlaylistService` after filtering but before track-matching. This is also where bounded concurrency from Approach 1 plugs in cleanly.
- **Playlist filter pre-pass**: `filterReleases` already runs purely against the local DB, so the on-demand fetch happens after filtering — meaning a typed-filter playlist of 50 releases only fetches 50 tracklists, not 500.
- A `--prefetch-tracklists` flag on `collection sync` lets power users opt back into the old behaviour for offline scenarios.

### Pros

- **Eliminates the dominant cost of sync entirely** rather than just parallelizing it. ~30x speedup on the headline sync benchmark.
- For users whose typical playlist filter selects a subset of the collection, the total Discogs work across the lifetime of the tool drops significantly (each release's tracklist is fetched at most once, and only if that release ends up in a playlist).
- Doesn't introduce concurrency-related bugs.
- Composes with Approach 1: on-demand tracklist fetch can run with concurrency.
- The `releases.tracklist_loaded` flag is a natural place to add per-release freshness/TTL later.

### Cons

- **Adds latency to the *first* `playlist create` after a sync** — releases without cached tracklists trigger Discogs fetches at playlist-create time. If the user runs `sync` and then `playlist create --filter "all"`, total wall clock is unchanged (the work just moves stages).
- Schema migration required (`releases.tracklist_loaded`). Need to backfill existing rows as `1` so they aren't re-fetched.
- Slightly more complex error handling: a tracklist fetch failure in the middle of playlist-create now needs a recovery path, not just a retry-queue insert.
- Doesn't help the `playlist create 500 unmatched tracks` benchmark much on its own (the SoundCloud searches are the dominant cost there).

### Success criteria

- Existing tests pass; new tests cover lazy fetch, the `tracklist_loaded` flag, and error recovery during playlist-time tracklist fetch.
- **Sync 500 records: ~10-15 min → ~10-20 sec** (~50x). Only the 10 paginated collection-list calls run.
- **Playlist create 500 unmatched tracks (after a fresh sync, no cached tracklists)**: today ~15-30 min → ~25-40 min, because the 500 deferred tracklist fetches now run inside playlist-create. **Combined with Approach 1's concurrency**: ~10-18 min (saved by parallelizing the tracklist fetches).
- **Playlist create where tracklists are already loaded (typical second-run case)**: unchanged at ~15-30 min, but the *cumulative* time of `sync` + `create` drops significantly.

### Tests needed

- **Migration test: `tracklist_loaded` backfill.** Open a pre-migration DB fixture with 50 releases (all with cached tracklists). Run the migration. Assert (a) the column exists, (b) all 50 rows are flagged `tracklist_loaded = 1`, (c) no row data was lost, (d) re-running the migration is idempotent.
- **Unit: `syncCollection` writes from `basic_information` only.** Mock `getCollectionPaginated` to return 10 releases with full `basic_information`. Spy on `getRelease`. Assert `getRelease` is **never called**, all 10 releases land in SQLite with the right title/artists/year/genres/styles, and `tracklist_loaded` is `0` for all of them.
- **Unit: `ensureTracklistsLoaded` is selective.** Seed the DB with 20 releases, 12 with `tracklist_loaded = 1` and 8 with `tracklist_loaded = 0`. Call `ensureTracklistsLoaded([...all 20 IDs])`. Assert exactly 8 `getRelease` calls happen, the flag flips to `1` after success, and no calls happen if all flags are already `1`.
- **Unit: `ensureTracklistsLoaded` failure handling.** With one of the 8 fetches throwing a 404, assert that release goes to DLQ, the other 7 still complete, and the function does not throw.
- **Unit: `ensureTracklistsLoaded` failure handling for transient errors.** A 503 should land the release in the retry queue, not the DLQ, mirroring current `syncCollection` behaviour.
- **Integration: lazy fetch end-to-end.** Run `sync`, then `playlist create` with a filter selecting 30 of 500 releases. Verify (a) sync issues only the paginated collection-list calls, (b) playlist-create issues exactly 30 `getRelease` calls, (c) the resulting playlist is identical to the eager-fetch baseline, (d) re-running playlist-create issues 0 `getRelease` calls.
- **Integration: `--prefetch-tracklists` opt-in flag.** Verify that passing this flag restores eager fetching during `sync` (for offline-prep scenarios) and that `tracklist_loaded` is `1` afterwards.
- **Regression: existing sync tests need to be re-baselined.** Tests that previously asserted "sync calls `getRelease` for each release" become invalid and must be updated to assert the new contract.

---

## Approach 3 — Smarter matching (fewer SoundCloud calls per track)

### Description

The track-matching path is search-heavy. Three changes that reduce the *number* of SoundCloud calls per track without changing the matching algorithm's quality:

1. **Bulk cache pre-fetch.** Before the per-track loop in `searchTracksForReleases`, run a single `SELECT * FROM track_matches WHERE discogsReleaseId IN (...)` query to load every cached match for the candidate release set into an in-memory `Map<string, CachedMatch>` keyed by `releaseId|trackTitle`. Per-track lookups become O(1) in-memory hits, avoiding 500 sequential `getCachedTrackMatch` SQL calls.
2. **Strategy pruning with feedback.** Today `searchWithFallback` runs up to 4 query strategies per track. Instrument the strategies, write a `match_strategy_stats` table with `strategy_index → success_count` over time, and then prune strategies whose historical hit rate after the previous strategy succeeded is < 5%. Anecdotally this is strategies 3-4. This roughly halves the average per-track call count without hurting match rate measurably.
3. **In-session search memoization + negative cache.** Many tracks on the same release share a query (e.g. `"Artist Album"`). Memoize SoundCloud search responses by query string within a single playlist-create invocation so duplicates collapse. Also persist negative results (`unmatched_tracks` already exists for review — wire it into the lookup path with a TTL, e.g. 30 days, so a re-run doesn't redo the same fruitless 4-strategy search).

### Pros

- **Reduces work** rather than parallelizing it, so the gains stack on top of Approach 1 instead of competing.
- Bulk cache pre-fetch is essentially a free win — same algorithm, one query instead of N.
- Strategy pruning is data-driven and reversible (the stats table tells you when a strategy is worth re-enabling).
- Negative cache makes the *second* run of an unsuccessful playlist-create nearly instant for the unmatched portion.
- No concurrency-related complexity.

### Cons

- **Cold-run improvement on the headline benchmark is modest** (~30%). The headline scenario explicitly says "500 tracks that aren't matched" — meaning no cache hits and worst-case strategy fallback, which is exactly what this approach optimizes least.
- Strategy pruning risks hiding legitimate matches if the data we collect isn't representative of a new user's collection. Need a `--exhaustive` escape hatch.
- Negative cache TTL is a knob users will get wrong — too short and it's pointless, too long and new uploads on SoundCloud get masked.
- Adds a new `match_strategy_stats` table and a new column on `unmatched_tracks` (or a TTL on the existing rows), increasing schema surface area.

### Success criteria

- Bulk cache pre-fetch reduces per-track SQL calls from N to 1; verified by query log.
- Strategy pruning is gated behind a stats threshold of ≥100 historical observations per strategy, so a fresh install still runs all strategies.
- **Sync 500 records**: unchanged (this approach doesn't touch the sync path).
- **Playlist create 500 unmatched tracks (cold)**: ~15-30 min → **~10-20 min** (~30-40% faster from strategy pruning + de-duped searches).
- **Playlist create 500 tracks where 80% are pre-matched**: ~15-30 min → **~3-6 min** (~5x, dominated by bulk cache pre-fetch eliminating 400 SQL round-trips and 400 SoundCloud calls).
- **Re-running a previously failed playlist create**: ~15-30 min → **~30 sec - 2 min** (negative cache short-circuits the previously-unmatched tracks).

### Tests needed

- **Unit: bulk cache pre-fetch loads correct rows.** Seed `track_matches` with 100 entries spanning 30 releases. Call the new bulk loader with all 30 release IDs. Assert (a) one SQL statement is prepared (count via spy), (b) the returned `Map<string, CachedMatch>` contains exactly 100 entries keyed by `releaseId|trackTitle`, (c) lookups by `(releaseId, trackTitle)` return the same shape as the old `getCachedTrackMatch` for all 100.
- **Unit: bulk cache pre-fetch with empty input.** Calling the bulk loader with `[]` returns an empty Map and issues zero SQL queries.
- **Unit: per-track lookup falls through to in-memory map.** With the in-memory map populated, `searchTracksForReleases` must not call `getCachedTrackMatch` even once for cached tracks. Verify with a spy.
- **Unit: cache miss still searches.** Tracks not in the pre-fetched map fall through to `searchWithFallback` exactly as before.
- **Unit: `match_strategy_stats` records hits.** Run a fixture where strategy 2 produces a match. Verify a row is written with `strategy_index = 2` and `success_count` incremented. Stats writes must not block or fail the search if SQLite is busy.
- **Unit: strategy pruning gate.** With <100 observations for strategy 4, all 4 strategies must run. With ≥100 observations and <5% hit rate, strategy 4 must be skipped. With `--exhaustive`, all 4 always run regardless.
- **Unit: in-session search memoization.** Call `searchWithFallback` for two tracks on the same release whose first-strategy queries are identical. Assert the SoundCloud client is called once, not twice.
- **Unit: negative cache short-circuit.** Seed `unmatched_tracks` with a row for `(releaseId, trackTitle)` dated 5 days ago. Run playlist-create. Assert no SoundCloud calls are made for that track. Then re-seed with a row dated 35 days ago (past TTL); assert the search runs normally.
- **Unit: negative cache write-on-miss.** When `searchWithFallback` exhausts strategies with no match, an `unmatched_tracks` row must be written with the current timestamp (existing behaviour) AND the row must be picked up on the next run within TTL.
- **Integration: warm-cache playlist create.** Build a 500-track playlist where 400 tracks have `track_matches` rows. Verify (a) only ~100 SoundCloud searches happen (down from ~400-1600), (b) wall clock is dramatically lower than the cold baseline, (c) the playlist contents are identical to running with the per-track lookup path.
- **Integration: re-run after partial failure.** First run leaves 50 tracks unmatched. Second run (within TTL) skips those 50 and only searches the new ones. Third run with `--exhaustive` re-searches the 50.
- **Regression: match quality.** Run the existing fixture set with strategy pruning enabled and assert the match-rate metric is within 1% of the pre-change baseline. If pruning hurts quality on the fixtures, the threshold needs tuning before merge.

---

## Recommendation

**Ship Approach 1 (concurrency, scoped to `TrackSearchService` first), paired with the bulk cache pre-fetch from Approach 3. Deprioritize Approach 2 indefinitely.**

This is tuned for the actual usage pattern in this repo: **sync once and rarely re-sync, build many large playlists from filter slices that select hundreds of releases at a time**. Under that pattern:

- **Sync speed doesn't matter much.** It's a one-time cost that's already been paid. Approach 2's headline 50x sync speedup translates to "saves ~10 minutes that you'll experience maybe twice a year." Not worth the schema migration or the complexity.
- **Approach 2 actively hurts the hot path.** Deferring tracklist fetches into playlist-create time would slow down the *one path that runs constantly*. That's the wrong direction.
- **Playlist-create is the bottleneck**, and Approach 1 attacks it head-on. The 5-7x improvement on a 500-track build (15-30 min → 3-5 min) is the win that gets felt every time.
- **Bulk cache pre-fetch compounds with the usage pattern.** "Many playlists from the same collection" means heavy overlap on `track_matches` cache hits. Eliminating N sequential SQL round-trips inside the per-track loop is a half-day change with no downside, and it gets larger as the cache fills.

### Sequencing

1. **Bulk cache pre-fetch from Approach 3** (~half day). Free win, no risk, immediate improvement on every warm playlist build. Do this first because it's the smallest diff and validates the test infrastructure for the next step.
2. **Approach 1 concurrency, scoped to `TrackSearchService.searchTracksForReleases`** (~2-3 days). Default concurrency 8. Adds a `--concurrency` flag. This is the big-ticket change. Don't expand to the Discogs sync path yet — that path doesn't run often enough to justify the extra surface area.
3. **Negative-match cache from Approach 3** (~1 day). 30-day TTL, `--exhaustive` escape hatch. Pays off when the same unmatched tracks appear across multiple playlists.
4. **Strategy-pruning instrumentation from Approach 3** (~1 day to instrument, then wait for data). Ship the `match_strategy_stats` table and write path immediately so data accumulates; gate the actual pruning behind a "≥100 observations and <5% hit rate" threshold so it activates automatically once there's enough data to trust it.
5. **Approach 2: skip.** Revisit only if the usage pattern changes (e.g. the user starts force-syncing weekly to pick up new acquisitions, or starts running on machines without prior sync state).

### Combined predicted improvements (this user's hot path)

| Scenario | Today | After steps 1-2 | After all steps |
|---|---|---|---|
| Playlist 500 cold (no prior matches) | 15-30 min | 3-5 min | 2-4 min |
| Playlist 500 warm (80% prior matches) | 15-30 min | 1-3 min | <1 min |
| Re-run a failed 500-track build | 15-30 min | 3-5 min | 30 sec - 2 min |
| Sync 500 (rare path) | 10-15 min | unchanged | unchanged |
