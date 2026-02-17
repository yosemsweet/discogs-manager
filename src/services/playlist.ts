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

      onProgress({ stage: 'Creating playlist', current: 0, total: releases.length, message: title });
      const playlist = await this.soundcloudClient.createPlaylist(title, description);

      onProgress({ stage: 'Saving playlist', current: 1, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      let addedCount = 0;
      for (const release of releases) {
        // Throttle if approaching rate limit
        if (this.rateLimitService) {
          await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
        }

        onProgress({ 
          stage: 'Adding tracks to playlist', 
          current: addedCount + 1, 
          total: releases.length,
          message: `Searching for "${release.title}" by ${release.artists}`,
        });

        const searchQuery = `${release.title} ${release.artists}`;
        const tracks = await this.soundcloudClient.searchTrack(searchQuery, 1);

        if (tracks && tracks.length > 0) {
          const track = tracks[0];
          await this.soundcloudClient.addTrackToPlaylist(playlist.id, track.id);
          await this.db.addReleaseToPlaylist(playlist.id, release.discogsId, track.id);
        }

        addedCount++;
      }

      onProgress({ 
        stage: 'Playlist created', 
        current: releases.length, 
        total: releases.length,
        message: `Added ${addedCount} tracks to "${title}"`,
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
