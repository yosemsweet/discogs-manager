# Better Track Matching Improvements

## Overview

Implemented all four approaches from `feature-requests/track-matching-not-good-enough.md` to improve SoundCloud track matching accuracy. Changes span query normalization, scoring weights, candidate filtering, and playlist-based resolution.

## Iteration 1: All Four Approaches Combined

### Changes Made

#### Approach 2: Preserve Remix Qualifiers (`src/utils/query-normalizer.ts`)

**Problem:** `normalizeTrackTitle` stripped ALL parentheticals including musical qualifiers like "(Ada remix)" and "(Special Edit)". This made "Run Run Run (Ada remix)" identical to "Run Run Run", losing the signal needed to distinguish remixes.

**Fix:** Split the stripping regex into two passes:
1. First regex strips non-musical qualifiers: remastered, radio edit/mix, album version, single version, explicit, clean, deluxe, bonus
2. Second regex *extracts and preserves* musical qualifiers: remix, edit, mix, version, dub — moving them out of parentheses into the normalized string

**Result:** `normalizeTrackTitle("Run Run Run (Ada remix)")` now returns `"Run Run Run Ada remix"` instead of `"Run Run Run"`.

#### Approach 1: Reweight Artist + URL-Slug Matching (`src/services/track-matcher.ts`)

**Problem:** Title weight (0.6) dominated over artist weight (0.2). For generic track names like "Grow" or "Lesotho", the title score was identical across candidates, so the wrong artist could win on noise alone.

**Fix:**
- Reweighted: title=0.45, artist=0.35, duration=0.2 (artist weight nearly doubled)
- Added URL slug extraction from `permalink_url` in `scoreMatch()` — the slug (e.g., `touaneofficial` from `soundcloud.com/touaneofficial/grow`) is often a closer match to the Discogs artist name than the display username

**Result:** `touaneofficial/grow` now outscores `riiox/grow-sebastian-rios` for artist "Touane" because the slug "touaneofficial" has higher similarity to "Touane" than "riiox".

#### Approach 3: Artist-Gated Candidate Filtering (`src/services/track-matcher.ts`)

**Problem:** When multiple candidates had near-identical title scores, the wrong artist could win on small scoring noise.

**Fix:** Two-pass filtering in `findBestMatch()`:
1. Filter candidates by artist similarity gate (threshold: 0.3, using both username and URL slug)
2. Rank filtered candidates by full score (title + artist + duration)
3. If no candidates pass the gate, fall back to ungated ranking (preserves recall)

New public method `filterByArtistGate()` added for testability.

**Design decision:** The gate threshold (0.3) is intentionally low — it's meant to filter out clearly unrelated uploaders, not require exact artist matches. This handles cases like `touaneofficial` matching "Touane" (similarity ~0.5) while rejecting `riiox` (similarity ~0.13).

**Design decision:** Ungated fallback is deliberate. When searching for "One Of These Days" by The Notwist and only `castle_hearts` exists, returning that match is better than returning nothing — the user can still review it. But when both `castle_hearts` and `the-notwist` candidates exist, the gate ensures the correct one wins.

#### Approach 4 Fix: Title-Based Playlist Track Mapping (`src/services/track-matcher.ts`)

**Problem:** `mapPlaylistTracksToRelease` mapped by position when track counts matched. This violated the spec and would fail when playlist track order differs from release track order.

**Fix:** Always use title similarity as primary matching with duration as tiebreaker when title scores are within 0.05 of each other. Position is never used.

**Tiebreaker logic:** When two SC tracks have similar titles to a Discogs track (within 0.05), the one with closer duration wins. This handles cases like "Grow" vs "Grow (Extended)" where durations differ.

## Iteration 2: Real-World Failures (Notwist examples)

After testing against live SoundCloud data, two issues surfaced from `feature-requests/failing-the-notwist-examples.txt`:

### Bug 1: "Artist - Title" format on SoundCloud

**Problem:** SoundCloud tracks are often titled "Artist - Track Name" (e.g., "The Notwist - blank air" by fan account `alientransistor`). The matcher compared "Blank Air" against the full "The Notwist - blank air" string, getting only 48% title similarity. The wrong match ("Blank Air" by Sean Potts = 100% title, 17% artist = 63% total) won.

**Fix:** In `scoreMatch()`, detect " - " in candidate titles. If stripping the prefix gives a better title match, use the stripped title for scoring and use the prefix as an additional artist signal. Also updated `filterByArtistGate()` to check embedded artist in title.

**Result:** "The Notwist - blank air" by alientransistor now scores 100% (title: 100% after stripping prefix, artist: 100% from embedded "The Notwist"). The artist gate filters out Sean Potts/Human Hands, leaving only the correct match.

### Bug 2: Remix qualifier in search queries reduced results

**Problem:** After Approach 2 preserved remix qualifiers, search queries became too specific. Strategy 2 was `"Run Run Run Ada Remix Notwist"` instead of `"Run Run Run Notwist"`, causing SoundCloud to return irrelevant results (the correct track wasn't in any result set).

**Fix:** Added `QueryNormalizer.normalizeForSearch()` which strips ALL parentheticals (like the old behavior). Updated `buildSearchQuery()` and `buildQueryStrategies()` to use `normalizeForSearch` for query building, while `scoreMatch()` still uses `normalizeTrackTitle` (preserves remix/edit) for candidate discrimination.

**Result:** Search queries are broader ("Run Run Run Notwist"), increasing the chance of finding the correct track. Scoring still distinguishes "Run Run Run (Ada Remix)" from "Run Run Run" after results are returned.

### Design insight: Duration empty in DB

The Notwist "Magnificent Fall" tracks have empty duration strings in the SQLite database. The scoring code already handles this correctly — `track.duration || null` converts empty string to null, and `scoreMatch` skips the duration weight entirely when expectedDuration is null. The `totalWeight` normalizes to title+artist only (0.80), so missing duration doesn't penalize scores.

## Test Results

- 168 tests across `track-matcher.test.ts`, `query-normalizer.test.ts`, `track-matcher-accuracy.test.ts`, and `playlist-preflight.test.ts` — all passing
- Full suite: 816 passing, 0 failures, 1 pre-existing skip
- Match accuracy benchmark: 13/14 (92.9%) — threshold 75%
- Non-match accuracy: 6/6 (100%) — threshold 80%
- One known edge case: "Heroes" by David Bowie vs "Heroes (12 inch version)" scores 50% < 60% threshold due to the preserved "(12 inch version)" increasing title divergence. This is acceptable — the 12-inch version is genuinely a different version.

## Success Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| SC1.1 | Pass | touaneofficial/grow outscores riiox/grow |
| SC1.2 | Pass | touaneofficial/the-band outscores max-and-the-middlefingers |
| SC1.3 | Pass | touaneofficial/lesotho outscores madera_music/lesotho |
| SC1.4 | Pass | the-notwist/run-run-run-ada-remix outscores dutchmelrose/runrunrun |
| SC1.5 | Pass | No regressions in existing test suite |
| SC2.1 | Pass | "Run Run Run (Ada remix)" preserves "Ada remix" |
| SC2.2 | Pass | "Song (Remastered 2009)" still strips to "Song" |
| SC2.3 | Pass | "Track (feat. Someone)" still strips to "Track" |
| SC2.4 | Pass | Preserved qualifier improves discrimination |
| SC2.5 | Pass | Full example set accuracy maintained |
| SC3.1 | Pass | touaneofficial passes gate, riiox does not |
| SC3.2 | Pass | the-notwist passes gate, dutchmelrose does not |
| SC3.3 | Pass | Empty gate results in ungated fallback |
| SC3.4 | Pass | "One Of These Days" — ungated fallback for single-candidate scenario |
| SC4.1 | Pass | searchPlaylists returns results |
| SC4.2 | Pass | Playlist scoring selects artist playlist |
| SC4.3 | Pass | Track mapping by title similarity, not position |
| SC4.4 | Pass | Fallback to per-track when no playlist match |
| SC4.5 | Pass | Partial playlist results + per-track fallback |
| SC4.6 | Pass | 2 API calls for full playlist match |
| SC4.7 | Pass | No regression on fixtures |
| SC4.8 | Pass | Release.artists used when track.artists empty |
| SC4.9 | Pass | Track-level artist used for compilations |
| SC4.10 | Pass | Compilation preflight uses release artist |
| SC4.11 | Pass | Effective artist flows through all code paths |
