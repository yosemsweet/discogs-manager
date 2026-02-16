import { SoundCloudAPIClient } from '../api/soundcloud';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';

export class PlaylistService {
  private soundcloudClient: SoundCloudAPIClient;
  private db: DatabaseManager;

  constructor(soundcloudClient: SoundCloudAPIClient, db: DatabaseManager) {
    this.soundcloudClient = soundcloudClient;
    this.db = db;
  }

  async createPlaylist(title: string, releases: StoredRelease[], description?: string, onProgress: ProgressCallback = noopProgress) {
    try {
      onProgress({ stage: 'Creating playlist', current: 0, total: releases.length, message: title });
      const playlist = await this.soundcloudClient.createPlaylist(title, description);

      onProgress({ stage: 'Saving playlist', current: 1, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      let addedCount = 0;
      for (const release of releases) {
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
