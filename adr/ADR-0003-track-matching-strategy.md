# ADR-0003: Track Matching — Multi-Signal Fuzzy Scoring with Playlist Preflight

**Date:** 2026-04-04  
**Status:** Accepted

## Context

Discogs stores vinyl releases with track titles, artist names, positions, and durations. SoundCloud has no structured release catalogue — tracks are user-uploaded with freeform titles and usernames. Matching is fundamentally fuzzy: titles differ in casing, punctuation, version suffixes, and "Artist - Title" prefixing; uploader usernames are rarely the canonical artist name.

The original implementation took the first search result blindly, achieving ~40–60% accuracy.

## Decisions

### 1. Separate search normalization from scoring normalization

**Problem:** The same normalization can't serve both goals. Broad search queries need all parentheticals stripped. Accurate scoring needs remix/edit qualifiers preserved to distinguish "Run Run Run" from "Run Run Run (Ada Remix)".

**Decision:** Two normalization functions:
- `QueryNormalizer.normalizeForSearch()` — strips everything, used in `buildQueryStrategies()` for API queries
- `QueryNormalizer.normalizeTrackTitle()` — preserves musical qualifiers (remix, edit, mix, version, dub), strips non-musical ones (remastered, explicit, clean, radio edit), used in `TrackMatcher.scoreMatch()`

### 2. Weight artist higher than the original implementation assumed

**Problem:** Title weight 0.6 / artist weight 0.2 meant identical track names (e.g., "Grow", "Lesotho") were decided by noise, not by the uploader identity.

**Decision:** Title 0.45 / artist 0.35 / duration 0.20. Artist signal expanded to include the URL slug (e.g., `touaneofficial` from the permalink) and any artist prefix in "Artist - Title" formatted SC titles.

### 3. Artist gate before full scoring (two-pass)

**Problem:** A low-artist-similarity candidate with a perfect title match could still win outright.

**Decision:** `filterByArtistGate()` pre-filters to candidates with artist similarity ≥ 0.3 (username, URL slug, or embedded title prefix). The full weighted score then ranks only gated candidates. If no candidate passes the gate, fall back to ungated ranking to preserve recall — returning nothing is worse for the user.

### 4. Handle "Artist - Title" SoundCloud title format

**Problem:** Many SC uploads prefix the artist name (e.g., "The Notwist - blank air"). Comparing "Blank Air" to "The Notwist - blank air" gives ~48% title similarity, allowing unrelated uploaders to win on a clean title match.

**Decision:** In `scoreMatch()`, detect ` - ` in the candidate title. If stripping the prefix yields better title similarity, use the stripped title for scoring and treat the prefix as an additional artist signal. Same check in `filterByArtistGate()`. No-op when the pattern doesn't appear.

### 5. Skip duration when not available

**Problem:** Many Discogs releases have empty duration strings (12" vinyl often omits track times). Keeping duration in `totalWeight` when unavailable silently distorts confidence scores.

**Decision:** Duration is only added to both `score` and `totalWeight` when `expectedDuration` is non-empty and the candidate provides a duration. Confidence is always `score / totalWeight`, so missing dimensions don't penalize — they're absent from the calculation.

### 6. Playlist preflight before per-track search

**Problem:** Per-track search for a 6-track EP can require 6–24 API calls. Artists and labels frequently upload full releases as SoundCloud playlists. When a playlist exists, all tracks can be resolved in 2 calls.

**Decision:** For releases with >1 track, search SoundCloud playlists for `"{artist} {release}"` first. Score candidates by title + artist match (title 65%, artist 35%; hard reject only when titleScore < 0.3). On a confident match (≥ 0.5), fetch playlist tracks and map to Discogs tracklist by title similarity (duration as tiebreaker). Mapping is always title-based — never positional, since playlist track order may differ. Unmatched or no-playlist cases fall through to per-track search.

### 7. Cache all matches

**Decision:** Every successful match — from playlist preflight or per-track search — is written to `track_matches` keyed on `(releaseId, trackTitle)`. Cache is checked before any API call. This eliminates redundant searches when re-building playlists or running incremental updates.

## Rejected Alternatives

**Pure title matching with 0.8 threshold:** Too strict. Version suffixes and formatting differences (common on SC) reduce title scores enough to miss correct matches.

**Position-based playlist track mapping:** Rejected because SC playlist order doesn't reliably match Discogs tracklist order.

**Hard artist gate (no fallback):** Rejected because it causes recall loss for artists not directly on SoundCloud (fan/label uploads). Ungated fallback preserves recall at the cost of occasional wrong matches, which the unmatched-track review mechanism can catch.
