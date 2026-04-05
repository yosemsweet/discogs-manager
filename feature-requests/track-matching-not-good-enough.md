The current track matching algorithm isn't good enough, even with the fuzzy matching alogirthms we've added.

Here are a few examples from recent playlists. I'll share with the structure:
Track:
    Name: NAME
    Artist: Artist
    Release: Release name
    Matched: the url for the matched soundcloud track (may be empty)
    Correct: the url for the soundcloud track that should have been found (may be empty if no match exists)

Review the approach we have for matching, and come up with 3 different improvements we can try that will make the successful and correct match rate better. Each improvement should provide a testable hypothesis that you can validate searches with.

In order to proceed you must fill in the approach, success criteria and required tests part of this file.

Failing Examples:

Track:
    Name: One Of These Days
    Artist: The Notwist
    Release: Magnificent Fall
    Matched: https://soundcloud.com/morningcalmplaylist/magnificent-fall-shops?in=yosem-sweet/sets/the-notwist-magnificent-fall
    Correct:


Track:
    Name: Run Run Run (Ada remix)
    Artist: The Notwist
    Release: Magnificent Fall
    Matched: https://soundcloud.com/dutchmelrose/runrunrun?in=yosem-sweet/sets/the-notwist-magnificent-fall
    Correct: https://soundcloud.com/the-notwist/run-run-run-ada-remix

Track:
    Name: Blank Air
    Artist: The Notwist
    Release: Magnificent Fall
    Matched: https://soundcloud.com/sean-potts-657084693/blank-air?in=yosem-sweet/sets/the-notwist-magnificent-fall
    Correct: https://soundcloud.com/alientransistor/the-notwist-blank-air



Working Examples:
Track:
    Name: Lesotho
    Artist: Touane
    Release: Lesotho EP
    Matched: https://soundcloud.com/touaneofficial/lesotho?in=yosem-sweet/sets/touane-lesotho-ep
    Correct: https://soundcloud.com/touaneofficial/lesotho?in=touaneofficial/sets/lesotho-ep

Track:
    Name: Grow
    Artist: Touane
    Release: Lesotho EP
    Matched: https://soundcloud.com/touaneofficial/grow?in=yosem-sweet/sets/touane-lesotho-ep
    Correct: https://soundcloud.com/touaneofficial/grow?in=touaneofficial/sets/lesotho-ep

Track:
    Name: The Band
    Artist: Touane
    Release: Lesotho EP
    Matched: https://soundcloud.com/touaneofficial/the-band-1?in=yosem-sweet/sets/touane-lesotho-ep
    Correct: https://soundcloud.com/touaneofficial/the-band-1?in=touaneofficial/sets/lesotho-ep


Approach:

### Approach 1: Increase artist/uploader weight and add URL-slug artist matching

**Hypothesis:** The current artist weight (0.2) is too low relative to title weight (0.6). For generic track names ("Grow", "The Band", "Lesotho"), the title score dominates and the wrong artist wins. Additionally, SoundCloud URLs contain the uploader's slug (e.g., `touaneofficial`, `the-notwist`), which is often a closer match to the Discogs artist name than the display username. By increasing artist weight and comparing against the URL slug as well as the username, we can correctly prefer the right uploader.

**Testable hypothesis:** Reweighting to title=0.45, artist=0.35, duration=0.2 and adding URL-slug matching will cause the correct Touane and Notwist tracks to outscore the incorrect matches in all provided examples.

### Approach 2: Preserve remix/version qualifiers during normalization

**Hypothesis:** `normalizeTrackTitle` strips parentheticals like "(Ada remix)", which are critical for distinguishing remixes and edits from the original. "Run Run Run (Ada remix)" becomes "Run Run Run", matching any version of the song. By preserving remix/version/edit identifiers (while still stripping "Remastered", "Explicit", etc.), the title similarity score for the correct remix will be significantly higher than for unrelated versions.

**Testable hypothesis:** Keeping remix/edit/version-name parentheticals in the normalized title will cause "Run Run Run (Ada remix)" to match `the-notwist/run-run-run-ada-remix` instead of `dutchmelrose/runrunrun`, and will not regress matching for tracks that don't have these qualifiers.

### Approach 3: Artist-gated candidate filtering (two-pass scoring)

**Hypothesis:** When multiple candidates have similar title scores, a wrong-artist result often wins because the combined score is just barely higher due to noise. A two-pass approach — first filter candidates to those with artist similarity above a minimum threshold (e.g., 0.3), then rank by title+duration among survivors — will eliminate false matches from unrelated uploaders. If no candidates pass the artist gate, fall back to the ungated ranking to avoid reducing recall.

**Testable hypothesis:** For all Touane examples and "Run Run Run", the correct track's uploader passes the artist gate while the incorrect uploaders do not. The fallback ensures no regression on tracks where the artist isn't on SoundCloud.

### Approach 4: Release-as-playlist preflight search

**Hypothesis:** Artists and labels frequently upload entire releases (EPs, LPs, singles) as SoundCloud playlists (e.g., `touaneofficial/sets/lesotho-ep`). When the full release exists as a playlist, every track can be resolved in 2 API calls (one playlist search + one get-playlist-tracks) instead of N per-track searches with fallback strategies (6–24 calls for a 6-track EP). The tracks within an artist's own playlist are almost certainly the correct versions, eliminating fuzzy-matching ambiguity entirely.

The approach:
1. Before per-track searching, search SoundCloud playlists for `"{artist} {release title}"` via a new `searchPlaylists()` API method.
2. Score playlist candidates by comparing playlist title to release title. Artist/uploader match is a **boost, not a gate** — playlists may be uploaded by the artist, a fan, or the record label. If the artist name appears in the uploader's URL slug, that's a strong signal and should boost the score significantly, but a playlist with a matching title from a non-artist uploader can still be selected.
3. If a confident playlist match is found, fetch its tracks via the existing `getPlaylistTracks()` method and map them to the Discogs tracklist — **always by title similarity first** (primary), with **duration as a secondary tiebreaker** when title scores are close. Position/index order should NOT be used as the primary mapping strategy since playlist track order may differ from release track order.
4. Only fall back to per-track search for tracks not covered by the playlist match (e.g., bonus tracks, or if no playlist was found).

**Testable hypothesis:** Searching for "Touane Lesotho EP" as a playlist will find `touaneofficial/sets/lesotho-ep`, and extracting its tracks will correctly resolve all three tracks (Grow, The Band, Lesotho) without any per-track searching. For releases where no playlist exists, the system falls back to per-track search with no regression.

Success criteria:

### For Approach 4 (Release-as-playlist preflight):
- SC4.1: `SoundCloudAPIClient.searchPlaylists("Touane Lesotho EP")` returns results including `touaneofficial/sets/lesotho-ep`
- SC4.2: The playlist scoring logic selects `touaneofficial/sets/lesotho-ep` over unrelated playlists when searching for release "Lesotho EP". Artist match in the URL slug boosts the score but is not required — a playlist titled "Lesotho EP" uploaded by a label or fan can still match if the title is strong enough.
- SC4.3: Tracks extracted from the matched playlist are correctly mapped to all three Discogs tracks (Grow, The Band, Lesotho) by title similarity (primary) with duration as a secondary tiebreaker — NOT by position/index order
- SC4.4: When no playlist match is found (e.g., a single or obscure release), the system falls back to per-track search without error
- SC4.5: When a playlist is found but has fewer tracks than the Discogs release, unmatched tracks fall back to per-track search
- SC4.6: API call count for a fully-matched release is 2 (search + get tracks) instead of N × strategies-per-track
- SC4.7: No regression — releases that were already matched correctly via per-track search remain correct

### For artist resolution across release types:

Discogs data has three patterns for artist attribution:
1. **Release-level only** (89% of collection, 1347 releases): `tracks.artists` is empty, artist is on `releases.artists` (e.g., Touane - Lesotho EP)
2. **Track-level** (10%, 152 releases): each track has its own artist, typically compilations/DJ mixes (e.g., DJ-Kicks where each track is by a different artist)
3. **Mixed** (<1%, 9 releases): some tracks have artists, some don't

Both playlist preflight and per-track search must resolve the effective artist for each track using fallback logic: `track.artists || release.artists`.

- SC4.8: For a release-level-only release (e.g., Touane - Lesotho EP where `tracks.artists` is empty), the preflight search query includes the release artist "Touane" and playlist scoring uses "Touane" for artist comparison
- SC4.9: For a compilation release with per-track artists (e.g., DJ-Kicks), per-track search uses the track-level artist (e.g., "Rasco") rather than the release artist (e.g., "DJ Cam") for matching
- SC4.10: For a compilation release, playlist preflight uses the release artist for the search query (to find the compilation playlist) but per-track fallback uses each track's own artist for matching
- SC4.11: For per-track search, the effective artist (`track.artists || release.artists`) is used for query generation, candidate scoring, and near-miss recording

### For Approach 1 (Reweight artist + URL-slug matching):
- SC1.1: For "Grow" by Touane, `touaneofficial/grow` scores higher than `riiox/grow-sebastian-rios`
- SC1.2: For "The Band" by Touane, `touaneofficial/the-band-1` scores higher than `max-and-the-middlefingers/the-band-remaster-2026`
- SC1.3: For "Lesotho" by Touane, `touaneofficial/lesotho` scores higher than `madera_music/lesotho`
- SC1.4: For "Run Run Run (Ada remix)" by The Notwist, `the-notwist/run-run-run-ada-remix` scores higher than `dutchmelrose/runrunrun`
- SC1.5: No regression — existing correctly-matched tracks in the test suite remain correctly matched

### For Approach 2 (Preserve remix qualifiers):
- SC2.1: `normalizeTrackTitle("Run Run Run (Ada remix)")` retains "Ada remix" in the output
- SC2.2: `normalizeTrackTitle("Song (Remastered 2009)")` still strips "Remastered 2009"
- SC2.3: `normalizeTrackTitle("Track (feat. Someone)")` still strips featuring info
- SC2.4: Title similarity between "Run Run Run Ada remix" and "run run run ada remix" is significantly higher than between "Run Run Run Ada remix" and "runrunrun" (different song)
- SC2.5: Matching accuracy on the full example set does not decrease

### For Approach 3 (Artist-gated filtering):
- SC3.1: Given candidates for "Grow" including both `touaneofficial` and `riiox`, only `touaneofficial` passes the artist gate when searching for artist "Touane"
- SC3.2: Given candidates for "Run Run Run" including both `the-notwist` and `dutchmelrose`, only `the-notwist` passes the artist gate when searching for artist "The Notwist"
- SC3.3: When no candidate passes the artist gate, the system falls back to ungated ranking (no match dropped)
- SC3.4: For "One Of These Days" by The Notwist with no correct match available, the system either returns a match from a plausible uploader or returns no match (does not match an unrelated artist)

Required tests:

### Unit tests for Approach 1 (artist weight + URL slug):
- `TrackMatcher.scoreMatch returns higher score when candidate username matches expected artist` — compare scores for touaneofficial vs riiox given artist "Touane"
- `TrackMatcher.scoreMatch uses URL slug for artist comparison when available` — provide a candidate with a permalink_url containing the artist slug, verify it boosts the artist score
- `TrackMatcher.findBestMatch selects correct artist for generic title "Grow"` — provide candidates list with correct and incorrect uploaders, assert correct one wins
- `TrackMatcher.findBestMatch selects correct artist for generic title "Lesotho"` — same structure as above
- `TrackMatcher.findBestMatch selects correct artist for generic title "The Band"` — same structure as above
- `Weight change regression: existing matches remain correct` — run all existing test cases from track-matcher.test.ts and verify no regressions

### Unit tests for Approach 2 (remix preservation):
- `normalizeTrackTitle preserves remix qualifier in parentheses` — input "Run Run Run (Ada remix)", expect output contains "Ada remix"
- `normalizeTrackTitle preserves edit qualifier` — input "Song (Special Edit)", expect output contains "Special Edit"
- `normalizeTrackTitle still strips remastered` — input "Song (Remastered 2009)", expect "Song"
- `normalizeTrackTitle still strips featuring` — input "Song (feat. Artist)", expect "Song"
- `normalizeTrackTitle still strips explicit/clean/radio` — verify these non-musical qualifiers are still removed
- `calculateStringSimilarity scores "Run Run Run Ada remix" vs "run run run ada remix" higher than vs "runrunrun"` — verify the preserved qualifier improves discrimination
- `findBestMatch selects Ada remix over plain version` — provide candidates with and without remix in title, verify remix version wins

### Unit tests for Approach 3 (artist-gated filtering):
- `filterByArtistGate passes candidates with artist similarity >= threshold` — touaneofficial passes for "Touane", riiox does not
- `filterByArtistGate passes candidates where URL slug matches artist` — the-notwist slug passes for "The Notwist"
- `filterByArtistGate returns empty array when no candidates match` — verify behavior with all-unrelated candidates
- `findBestMatch with artist gate selects touaneofficial/grow over riiox/grow` — end-to-end test with gating enabled
- `findBestMatch with artist gate falls back to ungated when no candidates pass gate` — verify no recall loss
- `findBestMatch with artist gate handles missing user field gracefully` — candidates without user info don't crash the gate

### Unit tests for Approach 4 (release-as-playlist preflight):
- `SoundCloudAPIClient.searchPlaylists returns playlist results for a query` — verify the new method hits the correct endpoint and returns parsed results
- `SoundCloudAPIClient.searchPlaylists handles empty results gracefully` — no results returns empty array, not an error
- `scorePlaylistMatch scores artist's own playlist higher than unrelated playlist` — given playlist from touaneofficial titled "Lesotho EP" vs a playlist from another user, the artist's playlist scores higher due to URL slug boost
- `scorePlaylistMatch can match playlist from non-artist uploader` — a playlist titled "Lesotho EP" uploaded by a label or fan still scores above threshold based on title match alone
- `scorePlaylistMatch boosts score when artist appears in uploader URL slug` — a playlist whose URL slug contains the artist name scores higher than one that doesn't, all else being equal
- `mapPlaylistTracksToRelease maps tracks by title similarity` — given 3 playlist tracks and 3 Discogs tracks (even with matching counts), maps by title similarity not position
- `mapPlaylistTracksToRelease uses duration as tiebreaker when title scores are close` — given two SC tracks with similar titles, the one with closer duration to the Discogs track wins
- `mapPlaylistTracksToRelease maps correctly when playlist order differs from release order` — given playlist tracks in a different order than the Discogs tracklist, still pairs correctly by title
- `mapPlaylistTracksToRelease returns unmatched Discogs tracks` — tracks not found in the playlist are returned separately for per-track fallback
- `searchReleaseAsPlaylist returns all tracks when full playlist found` — end-to-end: search → score → fetch tracks → map, returns complete track list
- `searchReleaseAsPlaylist returns empty when no playlist matches` — no confident playlist match triggers fallback path
- `searchReleaseAsPlaylist returns partial results when playlist has fewer tracks` — matched tracks returned, unmatched tracks flagged for per-track search
- `searchTracksForReleases tries playlist preflight before per-track search` — verify the orchestration calls playlist search first, then only searches individually for unresolved tracks
- `searchTracksForReleases skips playlist preflight when release has only 1 track` — singles don't benefit from playlist search, skip to per-track

### Unit tests for artist resolution (SC4.8–SC4.11):
- `searchReleaseAsPlaylist uses release.artists when track.artists is empty` — given a release with artists="Touane" and tracks with empty artists, the preflight search query is "Touane Lesotho EP" and playlist scoring compares against "Touane"
- `searchReleaseAsPlaylist uses release.artists for compilation playlist search` — given a compilation (release.artists="DJ Cam"), the search query includes "DJ Cam" for finding the compilation playlist
- `searchWithFallback uses release.artists as fallback when track.artists is empty` — for a track with empty artists from release "Touane", the effective artist for scoring is "Touane"
- `searchWithFallback uses track.artists when available` — for a compilation track with artists="Rasco", the effective artist for scoring is "Rasco" (not the release artist "DJ Cam")
- `searchWithFallback uses effective artist for query strategies, scoring, and near-miss recording` — verify the effective artist flows through to QueryNormalizer.buildQueryStrategies, TrackMatcher.findBestMatch, and saveUnmatchedTrack

### Integration tests (all approaches combined):
- `Full example set: Run Run Run (Ada remix) matches the-notwist URL` — end-to-end with real example data
- `Full example set: all three Touane tracks match touaneofficial URLs` — end-to-end with Grow, The Band, Lesotho
- `Full example set: One Of These Days does not match unrelated artist` — verify either correct match or no match, not a false positive
- `Full example set: Touane Lesotho EP resolved via playlist preflight` — verify all 3 tracks found from playlist search without per-track fallback
- `Playlist preflight reduces API calls for multi-track releases` — compare call count with and without preflight for a release that exists as a playlist
- `Match rate does not regress on existing test fixtures` — run against all existing fixtures and compare match rate before/after

