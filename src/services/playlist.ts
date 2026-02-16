import { SoundCloudAPIClient } from '../api/soundcloud';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';

export class PlaylistService {
  private soundcloudClient: SoundCloudAPIClient;
  private db: DatabaseManager;

  constructor(soundcloudClient: SoundCloudAPIClient, db: DatabaseManager) {
    this.soundcloudClient = soundcloudClient;
    this.db = db;
  }

  async createPlaylist(title: string, releases: StoredRelease[], description?: string) {
    try {
      const playlist = await this.soundcloudClient.createPlaylist(title, description);

      await this.db.createPlaylist(playlist.id, title, description);

      for (const release of releases) {
        const searchQuery = `${release.title} ${release.artists}`;
        const tracks = await this.soundcloudClient.searchTrack(searchQuery, 1);

        if (tracks && tracks.length > 0) {
          const track = tracks[0];
          await this.soundcloudClient.addTrackToPlaylist(playlist.id, track.id);
          await this.db.addReleaseToPlaylist(playlist.id, release.discogsId, track.id);
        }
      }

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
