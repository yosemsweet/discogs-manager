I just ran through the review process for unknown tracks on the playlist "Acquired since Feb 16". I found a couple issues:
1. After resolving tracks that needed review and updating the playlist it took away most of the tracks needed. IIRC one of our architectural decisions specifies we need to send ALL tracks when updating a playlist.
2. I provided urls for most of the tracks I resolved, but I'm not sure the id that was extracted is correct. For example here is a url for the track "La Rumba Del Perdon": https://soundcloud.com/rosaliaofficial/la-rumba-del-perdon?in=rosaliaofficial/sets/lux-226901126&si=b0ebc904096747768602519117fe36b2&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing, the id that came back from the review process is 226901126, I don't think that's the soundcloud track id.

Success Criteria:

1. When a user provides a SoundCloud track URL during review, the system resolves the URL to the correct SoundCloud track ID via the SoundCloud API (`/resolve` endpoint), rather than extracting a numeric ID from the URL with regex.
2. The regex fallback (`/(\d+)/`) is only used when the input is a plain numeric ID, not a URL.
3. URLs with query parameters (e.g. `?in=artist/sets/playlist-123`) do not cause the wrong ID (playlist/set ID) to be extracted.
4. After resolving tracks during review, the playlist update preserves ALL existing tracks. The `_resolveTrack` function must include every previously-matched track in the PUT request — not just the newly resolved one.
5. The resolved track is correctly saved to the `playlist_releases` table, the `track_matches` cache, and the `unmatched_tracks` record is marked as resolved.
6. If URL resolution fails (e.g. track not found, network error), the user sees a clear error and can retry or skip.
7. The user sees confirmation of the resolved track's title (from the API response) so they can verify the right track was matched.

Tests:

### URL parsing and resolution (`tests/review.test.ts` or new test file)
- A full SoundCloud track URL (e.g. `https://soundcloud.com/artist/track-name`) is resolved via the API, not regex
- A SoundCloud URL with query params (`?in=`, `&si=`, etc.) does not extract a set/playlist ID as the track ID
- A plain numeric input (e.g. `12345678`) is accepted as a direct track ID without calling the resolve API
- An invalid URL (not SoundCloud, or 404 from resolve) produces a user-facing error and allows retry
- An empty or whitespace-only input is rejected

### Playlist update during review (`tests/review.test.ts`)
- After resolving a track, the PUT request includes all existing playlist tracks plus the newly resolved track
- Resolving multiple tracks sequentially accumulates them correctly (each PUT includes all previously resolved tracks)
- If the playlist has 0 existing tracks, the PUT sends only the newly resolved track

### Database state after resolution (`tests/review.test.ts`)
- `resolveUnmatchedTrack` is called with the correct SoundCloud track ID from the API (not from URL regex)
- `addReleaseToPlaylist` stores the correct soundcloudTrackId for the release
- `saveCachedTrackMatch` stores the resolved track for future reuse