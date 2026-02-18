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

      // Check if playlist already exists
      const existingPlaylist = await this.db.getPlaylistByTitle(title);
      
      if (existingPlaylist && existingPlaylist.soundcloudId) {
        // Update existing playlist - only add new tracks
        return await this.updatePlaylist(String(existingPlaylist.soundcloudId), title, releases, onProgress);
      }

      onProgress({ stage: 'Fetching tracklists', current: 0, total: releases.length, message: title });

      // Fetch tracklists from database and search for all tracks
      const trackData: Array<{ trackId: string; discogsId: number }> = [];
      let processedCount = 0;
      let totalTracks = 0;

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
                  totalTracks++;
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

      const validTrackIds = trackData.map(t => t.trackId);

      if (validTrackIds.length === 0) {
        throw new Error('No tracks found in SoundCloud for any releases');
      }

      // Create playlist with tracks, using batch insertion if too many tracks
      onProgress({ stage: 'Creating playlist', current: processedCount, total: releases.length, message: title });
      
      let playlist;
      const BATCH_SIZE = 100; // SoundCloud likely has a limit around 100-200 tracks per request
      
      if (validTrackIds.length <= BATCH_SIZE) {
        // Small enough for single request
        playlist = await this.soundcloudClient.createPlaylistWithTracks(
          title,
          validTrackIds,
          description || '',
          false // public playlist
        );
      } else {
        // Too many tracks - create empty playlist first, then add tracks in batches
        playlist = await this.soundcloudClient.createPlaylist(title, description || '', false);
        
        // Give SoundCloud API a moment to process the playlist creation
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Add tracks in batches
        for (let i = 0; i < validTrackIds.length; i += BATCH_SIZE) {
          const batch = validTrackIds.slice(i, i + BATCH_SIZE);
          onProgress({ 
            stage: 'Adding tracks to playlist', 
            current: i + batch.length, 
            total: validTrackIds.length,
            message: `Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validTrackIds.length / BATCH_SIZE)}`,
          });
          await this.soundcloudClient.addTracksToPlaylist(String(playlist.id), batch);
        }
      }

      onProgress({ stage: 'Saving playlist', current: processedCount + 1, total: releases.length });
      await this.db.createPlaylist(playlist.id, title, description);

      // Save all release-to-playlist mappings
      for (const { trackId, discogsId } of trackData) {
        await this.db.addReleaseToPlaylist(String(playlist.id), discogsId, trackId);
      }

      onProgress({ 
        stage: 'Playlist created', 
        current: releases.length, 
        total: releases.length,
        message: `Added ${validTrackIds.length} individual tracks from ${releases.length} releases to "${title}"`,
      });

      return playlist;
    } catch (error) {
      throw new Error(`Failed to create playlist: ${error}`);
    }
  }

  private async updatePlaylist(
    playlistId: string,
    title: string,
    releases: StoredRelease[],
    onProgress: ProgressCallback
  ) {
    onProgress({ stage: 'Updating playlist', current: 0, total: releases.length, message: title });

    // Fetch existing tracks in playlist from database
    const existingPlaylistTracks = await this.db.getPlaylistTracks(playlistId);
    const existingDiscogsIds = new Set(existingPlaylistTracks.map(t => t.releaseId));

    // Find new releases not yet in the playlist
    const newReleases = releases.filter(r => !existingDiscogsIds.has(r.discogsId));

    if (newReleases.length === 0) {
      onProgress({ 
        stage: 'Playlist up to date', 
        current: releases.length, 
        total: releases.length,
        message: `No new tracks to add to "${title}"`,
      });
      return await this.soundcloudClient.getPlaylist(playlistId);
    }

    onProgress({ stage: 'Fetching tracklists', current: 0, total: newReleases.length, message: title });

    // Fetch tracklists from database and search for new tracks
    const newTrackData: Array<{ trackId: string; discogsId: number }> = [];
    let processedCount = 0;

    for (const release of newReleases) {
      if (this.rateLimitService) {
        await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
      }

      onProgress({ 
        stage: 'Fetching tracklist', 
        current: processedCount + 1, 
        total: newReleases.length,
        message: `"${release.title}"`,
      });

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
                newTrackData.push({
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

    const newTrackIds = newTrackData.map(t => t.trackId);

    if (newTrackIds.length === 0) {
      onProgress({ 
        stage: 'Playlist up to date', 
        current: releases.length, 
        total: releases.length,
        message: `No new SoundCloud tracks found to add to "${title}"`,
      });
      return await this.soundcloudClient.getPlaylist(playlistId);
    }

    // Add new tracks to existing playlist with batching for large updates
    onProgress({ stage: 'Adding new tracks', current: processedCount, total: newReleases.length, message: title });
    
    const BATCH_SIZE = 100;
    if (newTrackIds.length <= BATCH_SIZE) {
      // Small batch - single request
      await this.soundcloudClient.addTracksToPlaylist(playlistId, newTrackIds);
    } else {
      // Large batch - split into multiple requests
      for (let i = 0; i < newTrackIds.length; i += BATCH_SIZE) {
        const batch = newTrackIds.slice(i, i + BATCH_SIZE);
        onProgress({ 
          stage: 'Adding new tracks', 
          current: i + batch.length, 
          total: newTrackIds.length,
          message: `Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newTrackIds.length / BATCH_SIZE)}`,
        });
        await this.soundcloudClient.addTracksToPlaylist(playlistId, batch);
      }
    }

    // Save new release-to-playlist mappings in database
    for (const { trackId, discogsId } of newTrackData) {
      await this.db.addReleaseToPlaylist(playlistId, discogsId, trackId);
    }

    onProgress({ 
      stage: 'Playlist updated', 
      current: newReleases.length, 
      total: newReleases.length,
      message: `Added ${newTrackIds.length} individual tracks from ${newReleases.length} new releases to "${title}"`,
    });

    return await this.soundcloudClient.getPlaylist(playlistId);
  }

  async getPlaylistInfo(playlistId: string) {
    return this.soundcloudClient.getPlaylist(playlistId);
  }

  async getStoredPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return this.db.getPlaylistReleases(playlistId);
  }
}
