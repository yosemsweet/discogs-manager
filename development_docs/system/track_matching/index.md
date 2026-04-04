# Track Matching System

How Discogs tracks are resolved to SoundCloud track IDs when building playlists.

---

## Flow

```
PlaylistService
  → TrackSearchService.searchTracksForReleases()
      → [1] Playlist Preflight (multi-track releases only)
      → [2] Per-Track Search with fallback strategies
              → [3] Scoring & Filtering
              → [4] Cache (read before, write after)
```

---

## Techniques

### [1] Playlist Preflight
**Files:** `src/services/track-search.ts` · `src/services/track-matcher.ts` · `src/api/soundcloud.ts`

Skips per-track searching by finding the whole release as a SoundCloud playlist first.

- Searches `"{artist} {release}"` via `SoundCloudAPIClient.searchPlaylists()`
- Scores playlist candidates by title similarity + artist match (username, URL slug)
- On a confident match, fetches all playlist tracks and maps them to the Discogs tracklist
- Unmatched tracks fall through to per-track search; singles always skip this step
- On a full hit: 2 API calls instead of N × strategies

### [2] Per-Track Search with Fallback Strategies
**Files:** `src/services/track-search.ts` · `src/utils/query-normalizer.ts`

Tries up to 4 progressively broader queries until a confident match is found:

1. `"{title} {artist} {album}"` — most specific
2. `"{title} {artist}"`
3. `"{title}"` — broadest
4. `"{title} {album}"`

Queries use `QueryNormalizer.normalizeForSearch()` which strips all parentheticals for broader recall. Each query fetches 10 candidates. First query to produce a confident match (≥ 0.6) stops the loop.

### [3] Scoring & Filtering
**Files:** `src/services/track-matcher.ts`

**Artist gate (two-pass):** `TrackMatcher.filterByArtistGate()` pre-filters candidates to those with artist similarity ≥ 0.3. Checks: display username, URL slug (e.g. `the-notwist` from the permalink), and embedded artist in "Artist - Title" SC title format. Falls back to ungated ranking if no candidates pass.

**Scoring:** `TrackMatcher.scoreMatch()` — weighted sum of three signals:
| Signal | Weight | Notes |
|--------|--------|-------|
| Title | 0.45 | Uses `normalizeTrackTitle()` which preserves remix/edit qualifiers |
| Artist | 0.35 | Best of: username, URL slug, embedded title prefix |
| Duration | 0.20 | Skipped entirely when Discogs duration is empty |

Title normalization (`normalizeTrackTitle`) preserves musical qualifiers like "(Ada remix)" but strips non-musical ones (Remastered, Explicit, Radio Edit). This lets the scorer distinguish remixes while search queries remain broad.

Confidence threshold: **0.6**. Below this, the track is unmatched and saved to `unmatched_tracks` for review.

**String similarity:** Combined Dice coefficient (60%) + Levenshtein (40%) via `TrackMatcher.calculateStringSimilarity()`.

### [4] Cache
**Files:** `src/services/track-search.ts` · `src/services/database.ts`

Reads from `track_match_cache` before any API call. Writes on every successful match (both per-track and playlist preflight). Cache key: `(releaseId, trackTitle)`.

---

## Artist Resolution

Discogs has three patterns; the effective artist for all matching is `track.artists || release.artists`:

- **Release-level** (89%): `track.artists` is empty, use `release.artists`
- **Track-level** (10%, compilations): each track has its own artist
- **Mixed** (<1%): some tracks have artists, some don't

Playlist preflight always uses `release.artists` for the search query (to find the compilation/album playlist). Per-track fallback uses the effective artist per track.

---

## Unmatched Tracks

Tracks that exhaust all strategies without a confident match are saved to `unmatched_tracks` via `db.saveUnmatchedTrack()` with the top-3 near-miss candidates (scored ≥ 0.3) for manual review.
