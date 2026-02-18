import { SoundCloudAPIClient } from '../api/soundcloud';
import { ProgressCallback, noopProgress } from '../utils/progress';

/**
 * Handles batch operations for playlists on SoundCloud
 * Responsibilities:
 * - Create playlists with batching for large track counts
 * - Add tracks to playlists with batching
 * - Split operations into manageable chunks
 */
export class PlaylistBatchManager {
  private readonly BATCH_SIZE = 100; // SoundCloud likely has a limit around 100-200 tracks per request

  constructor(private soundcloudClient: SoundCloudAPIClient) {}

  /**
   * Create a playlist, handling track batching if necessary
   * If trackIds exceeds BATCH_SIZE, creates empty playlist then adds tracks in batches
   */
  async createPlaylistWithBatching(
    title: string,
    trackIds: string[],
    description: string = '',
    isPublic: boolean = false,
    onProgress: ProgressCallback = noopProgress
  ) {
    onProgress({
      stage: 'Creating playlist',
      current: 0,
      total: trackIds.length,
      message: title,
    });

    let playlist;

    if (trackIds.length <= this.BATCH_SIZE) {
      // Small enough for single request
      playlist = await this.soundcloudClient.createPlaylistWithTracks(title, trackIds, description, isPublic);
    } else {
      // Too many tracks - create empty playlist first, then add tracks in batches
      playlist = await this.soundcloudClient.createPlaylist(title, description, isPublic);

      // Give SoundCloud API a moment to process the playlist creation
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add tracks in batches
      await this.addTracksInBatches(
        String(playlist.id),
        trackIds,
        onProgress
      );
    }

    return playlist;
  }

  /**
   * Add tracks to an existing playlist, handling batching automatically
   */
  async addTracksInBatches(
    playlistId: string,
    trackIds: string[],
    onProgress: ProgressCallback = noopProgress
  ) {
    if (trackIds.length === 0) {
      return;
    }

    if (trackIds.length <= this.BATCH_SIZE) {
      // Small batch - single request
      await this.soundcloudClient.addTracksToPlaylist(playlistId, trackIds);
    } else {
      // Large batch - split into multiple requests
      for (let i = 0; i < trackIds.length; i += this.BATCH_SIZE) {
        const batch = trackIds.slice(i, i + this.BATCH_SIZE);
        onProgress({
          stage: 'Adding tracks to playlist',
          current: i + batch.length,
          total: trackIds.length,
          message: `Batch ${Math.floor(i / this.BATCH_SIZE) + 1}/${Math.ceil(trackIds.length / this.BATCH_SIZE)}`,
        });
        await this.soundcloudClient.addTracksToPlaylist(playlistId, batch);
      }
    }
  }
}
