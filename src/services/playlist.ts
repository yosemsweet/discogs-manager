import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { TrackSearchService, TrackSearchOptions } from './track-search';
import { PlaylistBatchManager, SOUNDCLOUD_PLAYLIST_TRACK_LIMIT } from './playlist-batch';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { AppError } from '../utils/error-handler';

/**
 * Orchestrates playlist creation and management.
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
    onProgress: ProgressCallback = noopProgress,
    limit: number = SOUNDCLOUD_PLAYLIST_TRACK_LIMIT,
    searchOptions: TrackSearchOptions = {}
  ): Promise<{ id: string | number; trackCount: number; excludedCount: number }> {
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
        return await this.updatePlaylist(String(existingPlaylist.soundcloudId), title, releases, onProgress, limit, searchOptions);
      }

      onProgress({ stage: 'Fetching tracklists', current: 0, total: releases.length, message: title });

      // Search for tracks on SoundCloud, associating unmatched tracks with this playlist title
      const trackData = await this.trackSearchService.searchTracksForReleases(releases, onProgress, title, searchOptions);

      if (trackData.length === 0) {
        throw new Error('No tracks found in SoundCloud for any releases');
      }

      // Build a map of discogsId → addedAt for tie-breaking
      const addedAtMap = new Map<number, string>(
        releases.map(r => [r.discogsId, r.addedAt instanceof Date ? r.addedAt.toISOString() : String(r.addedAt)])
      );

      // Sort by confidence desc, newest addedAt as tie-breaker
      const sorted = [...trackData].sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        const aDate = addedAtMap.get(a.discogsId) || '';
        const bDate = addedAtMap.get(b.discogsId) || '';
        return bDate.localeCompare(aDate);
      });

      const included = sorted.slice(0, limit);
      const excluded = sorted.slice(limit);
      const includedTrackIds = included.map(t => t.trackId);

      // Create playlist with the included tracks
      const playlist = await this.batchManager.createPlaylistWithBatching(
        title,
        includedTrackIds,
        description || '',
        false, // public playlist
        onProgress
      );

      onProgress({ stage: 'Saving playlist', current: releases.length, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      // Save included release-to-playlist mappings
      for (const { trackId, discogsId } of included) {
        await this.db.addReleaseToPlaylist(String(playlist.id), discogsId, trackId);
      }

      // Save excluded tracks to the excluded_tracks table
      await this.saveExcludedTracks(title, excluded);

      onProgress({
        stage: 'Playlist created',
        current: releases.length,
        total: releases.length,
        message: `Added ${includedTrackIds.length} tracks to "${title}"${excluded.length > 0 ? `, ${excluded.length} excluded` : ''}`,
      });

      return { id: playlist.id, trackCount: includedTrackIds.length, excludedCount: excluded.length };
    } catch (error) {
      throw new Error(`Failed to create playlist: ${error}`);
    }
  }

  /**
   * Save excluded tracks to the DB, looking up each track's Discogs title
   * from track_matches via a single batch query.
   */
  private async saveExcludedTracks(
    playlistTitle: string,
    excluded: Array<{ trackId: string; discogsId: number; confidence: number }>
  ): Promise<void> {
    // Clear previous excluded records for this playlist
    await this.db.deleteExcludedTracks(playlistTitle);

    if (excluded.length === 0) return;

    // Batch-fetch track titles from track_matches
    const matchRows = await this.db.getMatchConfidenceByTrackIds(excluded.map(t => t.trackId));
    const titleMap = new Map<string, string>(
      matchRows.map(r => [r.soundcloudTrackId, r.discogsTrackTitle])
    );

    const records = excluded.map(t => ({
      discogsReleaseId: t.discogsId,
      discogsTrackTitle: titleMap.get(t.trackId) || '',
      soundcloudTrackId: t.trackId,
      confidence: t.confidence,
    }));

    await this.db.saveExcludedTracks(playlistTitle, records);
  }

  private async updatePlaylist(
    playlistId: string,
    title: string,
    releases: StoredRelease[],
    onProgress: ProgressCallback,
    limit: number = SOUNDCLOUD_PLAYLIST_TRACK_LIMIT,
    searchOptions: TrackSearchOptions = {}
  ): Promise<{ id: string | number; trackCount: number; excludedCount: number }> {
    onProgress({ stage: 'Updating playlist', current: 0, total: releases.length, message: title });

    // Fetch existing tracks in playlist from database
    const existingPlaylistTracks = await this.db.getPlaylistTracks(playlistId);
    const existingTrackIdSet = new Set(existingPlaylistTracks.map((t) => `${t.releaseId}:${t.soundcloudTrackId}`));
    const existingDiscogsIds = new Set(existingPlaylistTracks.map((t) => t.releaseId));
    const existingSoundCloudIds = existingPlaylistTracks.map((t) => t.soundcloudTrackId);

    // Backfill: check if any existing releases have cached matches not yet in playlist_releases
    const existingReleaseIds = Array.from(existingDiscogsIds);
    const cachedMatches = await this.db.getCachedTrackMatchesForReleases(existingReleaseIds);
    const backfillTracks: { trackId: string; discogsId: number }[] = [];
    for (const match of cachedMatches) {
      const key = `${match.discogsReleaseId}:${match.soundcloudTrackId}`;
      if (!existingTrackIdSet.has(key)) {
        backfillTracks.push({ trackId: match.soundcloudTrackId, discogsId: match.discogsReleaseId });
        existingSoundCloudIds.push(match.soundcloudTrackId);
        existingTrackIdSet.add(key);
      }
    }

    // Find new releases not yet in the playlist
    const newReleases = releases.filter((r) => !existingDiscogsIds.has(r.discogsId));

    let newTrackData: Array<{ trackId: string; discogsId: number; confidence: number }> = [];
    if (newReleases.length > 0) {
      onProgress({ stage: 'Fetching tracklists', current: 0, total: newReleases.length, message: title });
      newTrackData = await this.trackSearchService.searchTracksForReleases(newReleases, onProgress, title, searchOptions);
    }

    // Get confidence scores for all existing + backfilled tracks from the DB
    const allExistingIds = [...existingSoundCloudIds];
    const confidenceRows = await this.db.getMatchConfidenceByTrackIds(allExistingIds);
    const confidenceMap = new Map<string, { confidence: number; addedAt: string }>(
      confidenceRows.map(r => [r.soundcloudTrackId, { confidence: r.confidence, addedAt: r.addedAt }])
    );

    // Build addedAt map for new releases
    const addedAtMap = new Map<number, string>(
      releases.map(r => [r.discogsId, r.addedAt instanceof Date ? r.addedAt.toISOString() : String(r.addedAt)])
    );

    // Merge all unique candidates with confidence
    const seen = new Set<string>();
    const allCandidates: Array<{ trackId: string; discogsId: number; confidence: number; addedAt: string }> = [];

    for (const t of existingPlaylistTracks) {
      if (!seen.has(t.soundcloudTrackId)) {
        seen.add(t.soundcloudTrackId);
        const info = confidenceMap.get(t.soundcloudTrackId);
        allCandidates.push({
          trackId: t.soundcloudTrackId,
          discogsId: t.releaseId,
          confidence: info?.confidence ?? 0,
          addedAt: info?.addedAt ?? '',
        });
      }
    }
    for (const t of backfillTracks) {
      if (!seen.has(t.trackId)) {
        seen.add(t.trackId);
        const info = confidenceMap.get(t.trackId);
        allCandidates.push({
          trackId: t.trackId,
          discogsId: t.discogsId,
          confidence: info?.confidence ?? 0,
          addedAt: info?.addedAt ?? '',
        });
      }
    }
    for (const t of newTrackData) {
      if (!seen.has(t.trackId)) {
        seen.add(t.trackId);
        allCandidates.push({
          trackId: t.trackId,
          discogsId: t.discogsId,
          confidence: t.confidence,
          addedAt: addedAtMap.get(t.discogsId) ?? '',
        });
      }
    }

    if (allCandidates.length === 0) {
      onProgress({
        stage: 'Playlist up to date',
        current: releases.length,
        total: releases.length,
        message: `No tracks to add to "${title}"`,
      });
      return { id: playlistId, trackCount: 0, excludedCount: 0 };
    }

    // Sort by confidence desc, newest addedAt as tie-breaker
    allCandidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.addedAt.localeCompare(a.addedAt);
    });

    const included = allCandidates.slice(0, limit);
    const excluded = allCandidates.slice(limit);
    const allTrackIds = included.map(t => t.trackId);

    onProgress({
      stage: 'Syncing tracks to SoundCloud',
      current: 0,
      total: allTrackIds.length,
      message: title,
    });

    let finalPlaylistId = playlistId;
    try {
      await this.batchManager.addTracksInBatches(playlistId, allTrackIds, onProgress);
    } catch (error) {
      // If the SoundCloud playlist was deleted, recreate it and reassign the DB records
      if (error instanceof AppError && error.statusCode === 404) {
        onProgress({ stage: 'Recreating deleted playlist', current: 0, total: allTrackIds.length, message: title });
        const newPlaylist = await this.batchManager.createPlaylistWithBatching(
          title, allTrackIds, '', false, onProgress
        );
        finalPlaylistId = String(newPlaylist.id);
        await this.db.reassignPlaylist(playlistId, finalPlaylistId, title);
      } else {
        throw error;
      }
    }

    // Save backfilled and new release-to-playlist mappings in database
    for (const { trackId, discogsId } of backfillTracks) {
      await this.db.addReleaseToPlaylist(finalPlaylistId, discogsId, trackId);
    }
    for (const { trackId, discogsId } of newTrackData) {
      await this.db.addReleaseToPlaylist(finalPlaylistId, discogsId, trackId);
    }

    // Remove demoted tracks from playlist_releases (tracks that were re-sorted out of the top N)
    await this.db.removeTracksNotInList(finalPlaylistId, allTrackIds);

    // Re-save excluded tracks (replaces previous excluded set for this playlist)
    await this.saveExcludedTracks(title, excluded);

    onProgress({
      stage: 'Playlist updated',
      current: newReleases.length,
      total: newReleases.length,
      message: `Added ${newTrackData.length} tracks from ${newReleases.length} new releases to "${title}"`,
    });

    return { id: finalPlaylistId, trackCount: allTrackIds.length, excludedCount: excluded.length };
  }

  async getPlaylistInfo(playlistId: string) {
    return this.soundcloudClient.getPlaylist(playlistId);
  }

  async getStoredPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return this.db.getPlaylistReleases(playlistId);
  }
}
