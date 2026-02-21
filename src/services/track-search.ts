import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';

/**
 * Handles searching for tracks on SoundCloud given Discogs releases
 * Responsibilities:
 * - Fetch tracklists from database for each release
 * - Search SoundCloud API for each track
 * - Manage rate limiting during searches
 * - Return mapping of found track IDs
 */
export class TrackSearchService {
    constructor(
        private soundcloudClient: SoundCloudAPIClient,
        private db: DatabaseManager,
        private rateLimitService?: SoundCloudRateLimitService
    ) { }

    /**
     * Search for all tracks across multiple releases on SoundCloud
     * Returns array of {trackId, discogsId} mappings for found tracks
     */
    async searchTracksForReleases(
        releases: StoredRelease[],
        onProgress: ProgressCallback = noopProgress
    ): Promise<Array<{ trackId: string; discogsId: number }>> {
        const trackData: Array<{ trackId: string; discogsId: number }> = [];
        let processedCount = 0;

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
                console.warn(`Failed to fetch tracks for release ${release.discogsId}: ${error}`);
                // Continue with other releases
            }

            if (tracks && tracks.length > 0) {
                // Search for each individual track on SoundCloud
                for (const track of tracks) {
                    if (this.rateLimitService) {
                        await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                    }

                    const searchQuery = `${track.title} ${track.artists || ''}`;

                    try {
                        const response = await this.soundcloudClient.searchTrack(searchQuery, 1);
                        const searchResults = Array.isArray(response) ? response : (response?.collection || []);

                        if (searchResults && searchResults.length > 0) {
                            const foundTrack = searchResults[0];
                            const trackId = foundTrack.id || foundTrack.track_id;
                            if (trackId) {
                                trackData.push({
                                    trackId: trackId.toString(),
                                    discogsId: release.discogsId,
                                });
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to search for track "${searchQuery}": ${error}`);
                        // Continue with next track
                    }
                }
            }

            processedCount++;
        }

        return trackData;
    }
}
