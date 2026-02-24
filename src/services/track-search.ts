import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { QueryNormalizer } from '../utils/query-normalizer';
import { Logger } from '../utils/logger';
import { TrackMatcher, MatchCandidate } from './track-matcher';

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
    ): Promise<Array<{ trackId: string; discogsId: number }>> {
        const trackData: Array<{ trackId: string; discogsId: number }> = [];
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
                // Search for each individual track on SoundCloud
                for (const track of tracks) {
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
        // Check cache first
        try {
            const cachedMatch = await this.db.getCachedTrackMatch(release.discogsId, track.title);
            if (cachedMatch) {
                Logger.debug(
                    `Cache hit: "${track.title}" → "${cachedMatch.matchedTitle}" ` +
                    `(confidence: ${cachedMatch.confidence.toFixed(2)})`
                );
                return {
                    trackId: cachedMatch.soundcloudTrackId,
                    matchedTitle: cachedMatch.matchedTitle,
                    confidence: cachedMatch.confidence,
                };
            }
        } catch (error) {
            Logger.debug(`Cache lookup failed for "${track.title}": ${error}`);
            // Continue with search
        }

        // Generate multiple query strategies
        const strategies = QueryNormalizer.buildQueryStrategies(
            track.title,
            track.artists || '',
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

                if (searchResults && searchResults.length > 0) {
                    lastSearchResults = searchResults as MatchCandidate[];

                    // Use advanced fuzzy matching
                    const bestMatch = TrackMatcher.findBestMatch(
                        track.title,
                        track.artists || '',
                        track.duration || null,
                        lastSearchResults
                    );

                    if (bestMatch) {
                        Logger.debug(
                            `Match found using strategy ${i + 1}/${strategies.length}: "${query}"`
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
                                bestMatch.candidate.user?.username
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
            `No match found after trying ${strategies.length} query strategies for "${track.title}"`
        );

        if (playlistTitle) {
            try {
                // Find near-miss candidates (lower threshold 0.3 to surface anything useful)
                const nearMisses = TrackMatcher.findAllMatches(
                    track.title,
                    track.artists || '',
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
                    discogsArtist: track.artists || null,
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
