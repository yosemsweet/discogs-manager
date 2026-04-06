import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { QueryNormalizer } from '../utils/query-normalizer';
import { Logger } from '../utils/logger';
import { TrackMatcher, MatchCandidate, DiscogsTrackInfo } from './track-matcher';

/**
 * Handles searching for tracks on SoundCloud given Discogs releases
 * Responsibilities:
 * - Fetch tracklists from database for each release
 * - Search SoundCloud API for each track with improved matching
 * - Normalize queries and validate results
 * - Manage rate limiting during searches
 * - Return mapping of found track IDs with confidence scores
 */
export class TrackSearchService {
    // Configuration for search behavior
    private static readonly SEARCH_RESULT_LIMIT = 10; // Increased from 1 for better matching

    constructor(
        private soundcloudClient: SoundCloudAPIClient,
        private db: DatabaseManager,
        private rateLimitService?: SoundCloudRateLimitService
    ) { }

    /**
     * Search for all tracks across multiple releases on SoundCloud
     * Returns array of {trackId, discogsId} mappings for found tracks
     *
     * Improvements:
     * - Uses QueryNormalizer for better query construction
     * - Includes album context in search
     * - Fetches multiple results for validation
     * - Validates results with similarity checking
     * - Persists unmatched tracks with near-miss candidates for later review
     *
     * @param releases - Releases to search tracks for
     * @param onProgress - Progress callback
     * @param playlistTitle - Title of the playlist being built (used to associate unmatched tracks)
     */
    async searchTracksForReleases(
        releases: StoredRelease[],
        onProgress: ProgressCallback = noopProgress,
        playlistTitle?: string
    ): Promise<Array<{ trackId: string; discogsId: number; confidence: number }>> {
        const trackData: Array<{ trackId: string; discogsId: number; confidence: number }> = [];
        let processedCount = 0;
        let totalMatched = 0;
        let totalSearched = 0;

        for (const release of releases) {
            // Throttle if approaching rate limit
            if (this.rateLimitService) {
                await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
            }

            onProgress({
                stage: 'Fetching tracklist',
                current: processedCount + 1,
                total: releases.length,
                message: `"${release.title}"`,
            });

            // Get tracks from database for this release
            let tracks: any[] = [];
            try {
                tracks = await this.db.getTracksForRelease(release.discogsId);
            } catch (error) {
                Logger.warn(`Failed to fetch tracks for release ${release.discogsId}: ${error}`);
                // Continue with other releases
            }

            if (tracks && tracks.length > 0) {
                // Determine which tracks need per-track search
                let tracksToSearch = tracks;

                // Try playlist preflight for multi-track releases
                if (tracks.length > 1) {
                    Logger.debug(`Trying playlist preflight for "${release.title}" (${tracks.length} tracks)`);
                    const preflightResult = await this.searchReleaseAsPlaylist(release, tracks);
                    if (preflightResult) {
                        // Add matched tracks from playlist
                        for (const m of preflightResult.matched) {
                            trackData.push({ ...m });
                            totalMatched++;
                        }
                        totalSearched += tracks.length - preflightResult.unmatchedTracks.length;

                        // Only search for unmatched tracks individually
                        tracksToSearch = preflightResult.unmatchedTracks;

                        if (tracksToSearch.length === 0) {
                            // All tracks resolved via playlist — skip per-track search
                            processedCount++;
                            continue;
                        }
                    }
                }

                // Search for each individual track on SoundCloud
                for (const track of tracksToSearch) {
                    totalSearched++;

                    if (this.rateLimitService) {
                        await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                    }

                    // Try to find match using fallback strategies
                    const matchResult = await this.searchWithFallback(track, release, playlistTitle);

                    if (matchResult) {
                        trackData.push({
                            trackId: matchResult.trackId,
                            discogsId: release.discogsId,
                            confidence: matchResult.confidence,
                        });
                        totalMatched++;
                        Logger.debug(
                            `Matched track: "${track.title}" → "${matchResult.matchedTitle}" ` +
                            `(confidence: ${matchResult.confidence.toFixed(2)})`
                        );
                    } else {
                        Logger.warn(
                            `No confident match for "${track.title}" from "${release.title}"`
                        );
                    }
                }
            }

            processedCount++;
        }

        // Log final statistics
        const matchRate = totalSearched > 0 ? ((totalMatched / totalSearched) * 100).toFixed(1) : '0';
        Logger.info(
            `Track matching complete: ${totalMatched}/${totalSearched} tracks matched (${matchRate}%)`
        );

        return trackData;
    }

    /**
     * Attempt to resolve all tracks for a release by finding a matching SoundCloud playlist.
     *
     * Returns matched tracks and any unmatched tracks that need per-track fallback.
     * Returns null if no confident playlist match is found.
     */
    async searchReleaseAsPlaylist(
        release: StoredRelease,
        tracks: any[]
    ): Promise<{
        matched: Array<{ trackId: string; discogsId: number; confidence: number }>;
        unmatchedTracks: any[];
    } | null> {
        try {
            // Build the playlist search query: "Artist ReleaseTitle"
            // Prefer the release-level artist (always populated) over per-track artists (often empty)
            const artistName = release.artists || tracks[0]?.artists || '';
            const query = `${artistName} ${release.title}`.trim();

            if (this.rateLimitService) {
                await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
            }

            Logger.debug(`Playlist search query: "${query}"`);
            const playlists = await this.soundcloudClient.searchPlaylists(query, 5);

            if (!playlists || playlists.length === 0) {
                Logger.debug(`Playlist preflight: no results for "${query}"`);
                return null;
            }

            Logger.debug(`Playlist preflight: ${playlists.length} result(s) for "${query}"`);

            // Score playlists and find best match
            for (const p of playlists) {
                const score = TrackMatcher.scorePlaylistMatch(release.title, artistName, p);
                Logger.debug(
                    `  Playlist candidate: "${p.title}" by ${p.user?.username} → score ${score.toFixed(3)}` +
                    (p.permalink_url ? ` (${p.permalink_url})` : '')
                );
            }

            const bestMatch = TrackMatcher.findBestPlaylistMatch(
                release.title,
                artistName,
                playlists
            );

            if (!bestMatch) {
                Logger.debug(`Playlist preflight: no candidate above threshold (${TrackMatcher.getConfidenceThreshold()})`);
                return null;
            }

            Logger.debug(
                `Playlist preflight: selected "${bestMatch.playlist.title}" by ${bestMatch.playlist.user?.username} ` +
                `(confidence: ${bestMatch.confidence.toFixed(3)})`
            );

            // Fetch tracks from the matched playlist
            if (this.rateLimitService) {
                await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
            }

            const playlistTracks = await this.soundcloudClient.getPlaylistTracks(
                bestMatch.playlist.id.toString()
            );

            if (!playlistTracks || playlistTracks.length === 0) {
                Logger.debug(`Playlist preflight: "${bestMatch.playlist.title}" returned 0 tracks`);
                return null;
            }

            Logger.debug(`Playlist preflight: fetched ${playlistTracks.length} track(s) from playlist`);
            for (const pt of playlistTracks) {
                Logger.debug(`  SC track: "${pt.title}" by ${pt.user?.username} (id: ${pt.id})`);
            }

            // Map playlist tracks to Discogs tracks.
            // position = array index (0-based), used below to recover the original track
            // object from the `tracks` array when building unmatchedTracks.
            const discogsTrackInfos: DiscogsTrackInfo[] = tracks.map((t: any, i: number) => ({
                title: t.title,
                artists: t.artists || '',
                duration: t.duration || null,
                position: i,
            }));

            const mapping = TrackMatcher.mapPlaylistTracksToRelease(
                playlistTracks as MatchCandidate[],
                discogsTrackInfos
            );

            const matched = mapping.matched.map(m => ({
                trackId: (m.soundcloudTrack.id || (m.soundcloudTrack as any).track_id).toString(),
                discogsId: release.discogsId,
                confidence: bestMatch.confidence,
            }));

            // Cache matched tracks so future runs don't re-search
            for (const m of mapping.matched) {
                const trackId = (m.soundcloudTrack.id || (m.soundcloudTrack as any).track_id).toString();
                try {
                    await this.db.saveCachedTrackMatch(
                        release.discogsId,
                        m.discogsTrack.title,
                        trackId,
                        bestMatch.confidence,
                        m.soundcloudTrack.title,
                        m.soundcloudTrack.user?.username,
                        (m.soundcloudTrack as any).permalink_url || undefined
                    );
                } catch (error) {
                    Logger.debug(`Failed to cache playlist match for "${m.discogsTrack.title}": ${error}`);
                }
            }

            // Find the original track objects for unmatched tracks
            const unmatchedTracks = mapping.unmatched.map(um => {
                return tracks[um.position];
            });

            Logger.info(
                `Playlist preflight for "${release.title}": ${matched.length}/${tracks.length} tracks resolved`
            );

            return { matched, unmatchedTracks };
        } catch (error) {
            Logger.warn(`Playlist preflight failed for "${release.title}": ${error}`);
            return null;
        }
    }

    /**
     * Search for a track using multiple fallback strategies with caching
     *
     * First checks cache, then tries queries in this order:
     * 1. Track + Artist + Album (most specific)
     * 2. Track + Artist (no album)
     * 3. Track only (for well-known tracks)
     * 4. Album + Artist (for compilations/albums as single tracks)
     *
     * Successful matches are cached to database for future lookups.
     *
     * @param track - Track to search for
     * @param release - Release information for context
     * @returns Match result with confidence, or null if no match found
     */
    private async searchWithFallback(
        track: any,
        release: StoredRelease,
        playlistTitle?: string
    ): Promise<{ trackId: string; matchedTitle: string; confidence: number } | null> {
        // Use track-level artist if available, otherwise fall back to release-level artist
        const effectiveArtist = track.artists || release.artists || '';
        Logger.debug(`Per-track search: "${track.title}" by ${effectiveArtist || '(unknown)'} from "${release.title}"`);

        // Check cache first
        try {
            const cachedMatch = await this.db.getCachedTrackMatch(release.discogsId, track.title);
            if (cachedMatch) {
                Logger.debug(
                    `  Cache hit: "${track.title}" → "${cachedMatch.matchedTitle}" ` +
                    `(id: ${cachedMatch.soundcloudTrackId}, confidence: ${cachedMatch.confidence.toFixed(2)})`
                );
                return {
                    trackId: cachedMatch.soundcloudTrackId,
                    matchedTitle: cachedMatch.matchedTitle,
                    confidence: cachedMatch.confidence,
                };
            }
            Logger.debug(`  No cache entry for "${track.title}"`);
        } catch (error) {
            Logger.debug(`  Cache lookup failed for "${track.title}": ${error}`);
            // Continue with search
        }

        // Generate multiple query strategies
        const strategies = QueryNormalizer.buildQueryStrategies(
            track.title,
            effectiveArtist,
            release.title
        );

        // Track last set of search results so we can mine near-misses after exhausting strategies
        let lastSearchResults: MatchCandidate[] = [];

        // Try each strategy until we find a confident match
        for (let i = 0; i < strategies.length; i++) {
            const query = strategies[i];

            try {
                if (this.rateLimitService) {
                    await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                }

                const response = await this.soundcloudClient.searchTrack(
                    query,
                    TrackSearchService.SEARCH_RESULT_LIMIT
                );
                const searchResults = Array.isArray(response) ? response : (response?.collection || []);

                Logger.debug(`  Strategy ${i + 1}/${strategies.length}: "${query}" → ${searchResults?.length ?? 0} result(s)`);

                if (searchResults && searchResults.length > 0) {
                    lastSearchResults = searchResults as MatchCandidate[];

                    // Use advanced fuzzy matching
                    const bestMatch = TrackMatcher.findBestMatch(
                        track.title,
                        effectiveArtist,
                        track.duration || null,
                        lastSearchResults
                    );

                    // Log top candidates for visibility
                    const allScored = TrackMatcher.findAllMatches(
                        track.title, effectiveArtist, track.duration || null,
                        lastSearchResults, 0.0
                    );
                    for (const scored of allScored.slice(0, 3)) {
                        const bd = scored.breakdown;
                        Logger.debug(
                            `    "${scored.candidate.title}" by ${scored.candidate.user?.username} → ` +
                            `${(scored.confidence * 100).toFixed(0)}% ` +
                            `(title:${(bd.titleScore * 100).toFixed(0)}% artist:${(bd.artistScore * 100).toFixed(0)}% dur:${(bd.durationScore * 100).toFixed(0)}%)`
                        );
                    }

                    if (bestMatch) {
                        Logger.debug(
                            `  ✓ Match found via strategy ${i + 1}: "${bestMatch.candidate.title}" by ${bestMatch.candidate.user?.username} ` +
                            `(${(bestMatch.confidence * 100).toFixed(0)}%)`
                        );

                        const result = {
                            trackId: (bestMatch.candidate.id || (bestMatch.candidate as any).track_id).toString(),
                            matchedTitle: bestMatch.candidate.title,
                            confidence: bestMatch.confidence,
                        };

                        // Save to cache for future lookups
                        try {
                            await this.db.saveCachedTrackMatch(
                                release.discogsId,
                                track.title,
                                result.trackId,
                                result.confidence,
                                result.matchedTitle,
                                bestMatch.candidate.user?.username,
                                (bestMatch.candidate as any).permalink_url || undefined
                            );
                        } catch (error) {
                            Logger.debug(`Failed to cache match for "${track.title}": ${error}`);
                            // Don't fail the search just because caching failed
                        }

                        return result;
                    }
                }
            } catch (error) {
                Logger.debug(`Search failed for query "${query}": ${error}`);
                // Continue to next strategy
            }
        }

        // All strategies exhausted — collect near-miss candidates for manual review
        Logger.debug(
            `  ✗ No match for "${track.title}" after ${strategies.length} strategies`
        );

        if (playlistTitle) {
            try {
                // Find near-miss candidates (lower threshold 0.3 to surface anything useful)
                const nearMisses = TrackMatcher.findAllMatches(
                    track.title,
                    effectiveArtist,
                    track.duration || null,
                    lastSearchResults,
                    0.3
                ).slice(0, 3); // Keep top-3

                const topCandidatesJson = nearMisses.length > 0
                    ? JSON.stringify(nearMisses.map(m => ({
                        id: (m.candidate.id || (m.candidate as any).track_id || '').toString(),
                        title: m.candidate.title,
                        username: m.candidate.user?.username,
                        duration: m.candidate.duration,
                        confidence: m.confidence,
                        breakdown: m.breakdown,
                    })))
                    : null;

                await this.db.saveUnmatchedTrack({
                    playlistTitle,
                    discogsReleaseId: release.discogsId,
                    discogsTrackTitle: track.title,
                    discogsArtist: effectiveArtist || null,
                    discogsDuration: track.duration || null,
                    releaseTitle: release.title,
                    topCandidatesJson,
                    strategiesTriedCount: strategies.length,
                });
            } catch (error) {
                Logger.debug(`Failed to save unmatched track "${track.title}": ${error}`);
                // Don't fail the overall search
            }
        }

        return null;
    }
}
