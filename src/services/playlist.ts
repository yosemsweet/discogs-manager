import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { TrackSearchService } from './track-search';
import { PlaylistBatchManager } from './playlist-batch';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { ErrorHandler, AppError, ErrorType } from '../utils/error-handler';

/**
 * Orchestrates playlist creation and management
 * Delegates to:
 * - TrackSearchService for finding tracks on SoundCloud
 * - PlaylistBatchManager for batch operations
 * - DatabaseManager for persistence
 */
export class PlaylistService {
  private soundcloudClient: SoundCloudAPIClient;
  private db: DatabaseManager;
  private rateLimitService: SoundCloudRateLimitService | null;
  private trackSearchService: TrackSearchService;
  private batchManager: PlaylistBatchManager;

  constructor(
    soundcloudClient: SoundCloudAPIClient,
    db: DatabaseManager,
    rateLimitService?: SoundCloudRateLimitService
  ) {
    this.soundcloudClient = soundcloudClient;
    this.db = db;
    this.rateLimitService = rateLimitService || null;
    this.trackSearchService = new TrackSearchService(soundcloudClient, db, rateLimitService);
    this.batchManager = new PlaylistBatchManager(soundcloudClient);
  }

  async createPlaylist(
    title: string,
    releases: StoredRelease[],
    description?: string,
    onProgress: ProgressCallback = noopProgress
  ): Promise<{ id: string | number; trackCount: number }> {
    try {
      // Check rate limit before starting
      if (this.rateLimitService && this.rateLimitService.isLimitExceeded()) {
        throw new Error(
          `SoundCloud rate limit exceeded. ` +
          `Reset time: ${this.rateLimitService.getFormattedResetTime()}. ` +
          `Try again later.`
        );
      }

      // Check if playlist already exists
      const existingPlaylist = await this.db.getPlaylistByTitle(title);

      if (existingPlaylist && existingPlaylist.soundcloudId) {
        // Update existing playlist - only add new tracks
        return await this.updatePlaylist(String(existingPlaylist.soundcloudId), title, releases, onProgress);
      }

      onProgress({ stage: 'Fetching tracklists', current: 0, total: releases.length, message: title });

      // Search for tracks on SoundCloud, associating unmatched tracks with this playlist title
      const trackData = await this.trackSearchService.searchTracksForReleases(releases, onProgress, title);

      const validTrackIds = trackData.map((t) => t.trackId);

      if (validTrackIds.length === 0) {
        throw new Error('No tracks found in SoundCloud for any releases');
      }

      // Create playlist with batch handling
      const playlist = await this.batchManager.createPlaylistWithBatching(
        title,
        validTrackIds,
        description || '',
        false, // public playlist
        onProgress
      );

      onProgress({ stage: 'Saving playlist', current: releases.length, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      // Save all release-to-playlist mappings
      for (const { trackId, discogsId } of trackData) {
        await this.db.addReleaseToPlaylist(String(playlist.id), discogsId, trackId);
      }

      onProgress({
        stage: 'Playlist created',
        current: releases.length,
        total: releases.length,
        message: `Added ${validTrackIds.length} tracks from ${releases.length} releases to "${title}"`,
      });

      return { id: playlist.id, trackCount: validTrackIds.length };
    } catch (error) {
      throw new Error(`Failed to create playlist: ${error}`);
    }
  }

  private async updatePlaylist(
    playlistId: string,
    title: string,
    releases: StoredRelease[],
    onProgress: ProgressCallback
  ): Promise<{ id: string | number; trackCount: number }> {
    onProgress({ stage: 'Updating playlist', current: 0, total: releases.length, message: title });

    // Fetch existing tracks in playlist from database
    const existingPlaylistTracks = await this.db.getPlaylistTracks(playlistId);
    const existingDiscogsIds = new Set(existingPlaylistTracks.map((t) => t.releaseId));
    // Keep existing SoundCloud track IDs so the PUT doesn't wipe them
    const existingSoundCloudIds = existingPlaylistTracks.map((t) => t.soundcloudTrackId);

    // Find new releases not yet in the playlist
    const newReleases = releases.filter((r) => !existingDiscogsIds.has(r.discogsId));

    let newTrackData: { trackId: string; discogsId: number }[] = [];
    if (newReleases.length > 0) {
      onProgress({ stage: 'Fetching tracklists', current: 0, total: newReleases.length, message: title });

      // Search for new tracks on SoundCloud, associating unmatched tracks with this playlist
      newTrackData = await this.trackSearchService.searchTracksForReleases(newReleases, onProgress, title);
    }

    const newTrackIds = newTrackData.map((t) => t.trackId);

    // Build the full track list: existing + newly matched.
    // Always PUT to SoundCloud so the playlist stays in sync even if previous
    // runs wiped tracks or no new matches were found this time.
    const allTrackIds = [...existingSoundCloudIds, ...newTrackIds];

    if (allTrackIds.length === 0) {
      onProgress({
        stage: 'Playlist up to date',
        current: releases.length,
        total: releases.length,
        message: `No tracks to add to "${title}"`,
      });
      return { id: playlistId, trackCount: 0 };
    }

    onProgress({
      stage: 'Syncing tracks to SoundCloud',
      current: 0,
      total: allTrackIds.length,
      message: title,
    });

    await this.batchManager.addTracksInBatches(playlistId, allTrackIds, onProgress);

    // Save new release-to-playlist mappings in database
    for (const { trackId, discogsId } of newTrackData) {
      await this.db.addReleaseToPlaylist(playlistId, discogsId, trackId);
    }

    onProgress({
      stage: 'Playlist updated',
      current: newReleases.length,
      total: newReleases.length,
      message: `Added ${newTrackIds.length} tracks from ${newReleases.length} new releases to "${title}"`,
    });

    return { id: playlistId, trackCount: allTrackIds.length };
  }

  async getPlaylistInfo(playlistId: string) {
    return this.soundcloudClient.getPlaylist(playlistId);
  }

  async getStoredPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return this.db.getPlaylistReleases(playlistId);
  }
}
