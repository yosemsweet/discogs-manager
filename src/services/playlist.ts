import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';

export class PlaylistService {
  private soundcloudClient: SoundCloudAPIClient;
  private db: DatabaseManager;
  private rateLimitService: SoundCloudRateLimitService | null;

  constructor(
    soundcloudClient: SoundCloudAPIClient,
    db: DatabaseManager,
    rateLimitService?: SoundCloudRateLimitService
  ) {
    this.soundcloudClient = soundcloudClient;
    this.db = db;
    this.rateLimitService = rateLimitService || null;
  }

  async createPlaylist(title: string, releases: StoredRelease[], description?: string, onProgress: ProgressCallback = noopProgress) {
    try {
      // Check rate limit before starting
      if (this.rateLimitService && this.rateLimitService.isLimitExceeded()) {
        throw new Error(
          `SoundCloud rate limit exceeded. ` +
          `Reset time: ${this.rateLimitService.getFormattedResetTime()}. ` +
          `Try again later.`
        );
      }

      onProgress({ stage: 'Searching for tracks', current: 0, total: releases.length, message: title });

      // Search for all tracks first and collect valid track IDs
      const trackData: Array<{ trackId: string; discogsId: number }> = [];
      let searchedCount = 0;

      for (const release of releases) {
        // Throttle if approaching rate limit
        if (this.rateLimitService) {
          await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
        }

        onProgress({ 
          stage: 'Searching for tracks', 
          current: searchedCount + 1, 
          total: releases.length,
          message: `"${release.title}" by ${release.artists}`,
        });

        const searchQuery = `${release.title} ${release.artists}`;
        const response = await this.soundcloudClient.searchTrack(searchQuery, 1);

        // Handle different response structures
        const tracks = Array.isArray(response) ? response : (response?.collection || []);
        
        if (tracks && tracks.length > 0) {
          const track = tracks[0];
          const trackId = track.id || track.track_id;
          if (trackId) {
            trackData.push({
              trackId: trackId.toString(),
              discogsId: release.discogsId,
            });
          }
        }

        searchedCount++;
      }

      const validTrackIds = trackData.map(t => t.trackId);

      if (validTrackIds.length === 0) {
        throw new Error('No tracks found in SoundCloud for any releases');
      }

      // Create playlist with all tracks in a single API call
      onProgress({ stage: 'Creating playlist', current: searchedCount, total: releases.length, message: title });
      const playlist = await this.soundcloudClient.createPlaylistWithTracks(
        title,
        validTrackIds,
        description || '',
        false // public playlist
      );

      onProgress({ stage: 'Saving playlist', current: searchedCount + 1, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      // Save all release-to-playlist mappings
      for (const { trackId, discogsId } of trackData) {
        await this.db.addReleaseToPlaylist(playlist.id, discogsId, trackId);
      }

      onProgress({ 
        stage: 'Playlist created', 
        current: releases.length, 
        total: releases.length,
        message: `Added ${validTrackIds.length} tracks to "${title}"`,
      });

      return playlist;
    } catch (error) {
      throw new Error(`Failed to create playlist: ${error}`);
    }
  }

  async getPlaylistInfo(playlistId: string) {
    return this.soundcloudClient.getPlaylist(playlistId);
  }

  async getStoredPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return this.db.getPlaylistReleases(playlistId);
  }
}
