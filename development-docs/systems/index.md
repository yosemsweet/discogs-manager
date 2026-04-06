# Systems Index

| System | Location | Purpose |
|--------|----------|---------|
| [Collection Sync](collection-sync/documentation.md) | `src/services/collection.ts`, `src/commands/sync.ts`, `src/commands/collection.ts` | Fetches the user's Discogs vinyl collection and stores it in SQLite |
| [Playlist Management](playlist-management/documentation.md) | `src/services/playlist*.ts`, `src/commands/playlist.ts`, `src/commands/review.ts`, `src/commands/export.ts`, `src/commands/lookup.ts`, `src/commands/track.ts` | Creates, updates, deletes, and exports SoundCloud playlists; reverse URL lookup |
| [Track Matching](track-matching/documentation.md) | `src/services/track-matcher.ts`, `src/services/track-search.ts`, `src/utils/query-normalizer.ts` | Resolves Discogs track titles to SoundCloud track IDs using fuzzy matching |
| [SoundCloud OAuth](soundcloud-oauth/documentation.md) | `src/services/soundcloud-oauth.ts`, `src/commands/auth.ts`, `src/commands/soundcloud.ts` | OAuth 2.1 with PKCE authentication flow and encrypted token storage |
| [Resilience](resilience/documentation.md) | `src/services/circuit-breaker.ts`, `src/services/sync-checkpoint.ts`, `src/services/timeout-handler.ts` | Circuit breaker, sync checkpoints, and timeout handling for fault tolerance |
| [Collection Query](collection-query/documentation.md) | `src/services/query/`, `src/commands/query.ts` | Ad-hoc DSL for querying the local collection; parse → validate → build → execute → format pipeline |
