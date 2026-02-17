import axios, { AxiosInstance, AxiosError } from 'axios';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { Logger } from '../utils/logger';

export class SoundCloudAPIClientError extends Error {
  constructor(
    public statusCode?: number,
    public originalError?: any,
    message?: string
  ) {
    super(message || 'SoundCloud API Error');
    this.name = 'SoundCloudAPIClientError';
  }
}

export class SoundCloudRateLimitError extends SoundCloudAPIClientError {
  constructor(
    public remainingRequests: number,
    public resetTime: string,
    public maxRequests: number = 15000,
    message?: string
  ) {
    super(
      429,
      undefined,
      message || `Rate limit exceeded. ${remainingRequests} requests remaining. Reset at ${resetTime}`
    );
    this.name = 'SoundCloudRateLimitError';
  }
}

export class SoundCloudAPIClient {
  private client: AxiosInstance;
  private accessToken: string;

  constructor(accessToken: string) {
    if (!accessToken) {
      throw new Error('SoundCloud API requires an OAuth access token');
    }

    this.accessToken = accessToken;

    this.client = axios.create({
      baseURL: 'https://api.soundcloud.com',
      headers: {
        'Authorization': `OAuth ${accessToken}`,
      },
      timeout: 30000, // 30 second timeout
    });
  }

  private handleError(error: any, context: string): never {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data as any;

      switch (status) {
        case 400:
          throw new SoundCloudAPIClientError(400, error, `Bad request in ${context}: ${data?.error_description || 'Invalid parameters'}`);
        case 401:
        case 403:
          throw new SoundCloudAPIClientError(status, error, `Authentication failed in ${context}: Invalid or expired credentials`);
        case 404:
          throw new SoundCloudAPIClientError(404, error, `Not found in ${context}: The requested resource does not exist`);
        case 429:
          // Parse rate limit information from response
          const rateLimitInfo = this.parseRateLimitResponse(data);
          throw new SoundCloudRateLimitError(
            rateLimitInfo.remainingRequests,
            rateLimitInfo.resetTime,
            rateLimitInfo.maxRequests,
            `Rate limit exceeded in ${context}: ${rateLimitInfo.remainingRequests} requests remaining. Reset at ${rateLimitInfo.resetTime}`
          );
        case 500:
        case 502:
        case 503:
          throw new SoundCloudAPIClientError(status, error, `Server error (${status}) in ${context}: Please try again later`);
        default:
          throw new SoundCloudAPIClientError(status, error, `API error (${status}) in ${context}: ${data?.error_description || ''}`);
      }
    }

    if (axiosError.code === 'ECONNABORTED') {
      throw new SoundCloudAPIClientError(undefined, error, `Request timeout in ${context}: The server took too long to respond`);
    }

    if (axiosError.code === 'ENOTFOUND') {
      throw new SoundCloudAPIClientError(undefined, error, `Network error in ${context}: Unable to reach the SoundCloud API`);
    }

    throw new SoundCloudAPIClientError(undefined, error, `Unexpected error in ${context}: ${error.message}`);
  }

  /**
   * Parse rate limit information from 429 error response
   * Expected format:
   * {
   *   "errors": [{
   *     "meta": {
   *       "rate_limit": {
   *         "group": "plays",
   *         "max_nr_of_requests": 15000,
   *         "time_window": "PT24H"
   *       },
   *       "remaining_requests": 0,
   *       "reset_time": "2015/06/01 09:49:40 +0000"
   *     }
   *   }]
   * }
   */
  private parseRateLimitResponse(data: any): {
    remainingRequests: number;
    resetTime: string;
    maxRequests: number;
  } {
    try {
      const errors = data?.errors || [];
      if (errors.length > 0) {
        const meta = errors[0]?.meta;
        if (meta) {
          return {
            remainingRequests: meta.remaining_requests || 0,
            resetTime: meta.reset_time || 'unknown',
            maxRequests: meta.rate_limit?.max_nr_of_requests || 15000,
          };
        }
      }
    } catch (e) {
      // Fall back to defaults if parsing fails
    }

    return {
      remainingRequests: 0,
      resetTime: 'unknown',
      maxRequests: 15000,
    };
  }

  /**
   * Throttle requests when approaching SoundCloud rate limit.
   * Pauses execution if remaining requests are low, waits until reset, then resumes.
   *
   * @param rateLimitService - Service managing rate limit state
   * @throws {SoundCloudRateLimitError} if limit is exceeded
   */
  async throttleIfApproachingLimit(
    rateLimitService: SoundCloudRateLimitService
  ): Promise<void> {
    if (rateLimitService.isLimitExceeded()) {
      const state = rateLimitService.getState();
      throw new SoundCloudRateLimitError(
        state?.remaining || 0,
        state?.resetTime?.toISOString() || 'unknown',
        state?.maxRequests || 15000,
        'Rate limit exceeded. Cannot make requests until reset.'
      );
    }

    if (rateLimitService.isApproachingLimit()) {
      const timeUntilReset = rateLimitService.getTimeUntilReset();
      const humanReadableTime = rateLimitService.getTimeUntilResetHuman();

      Logger.warn(
        `[SoundCloud] Approaching rate limit (${rateLimitService.getState()?.remaining} requests remaining). ` +
          `Pausing for ${humanReadableTime} until reset at ${rateLimitService.getFormattedResetTime()}`
      );

      // Wait until reset
      await new Promise((resolve) => setTimeout(resolve, timeUntilReset));

      // Reset service state after waiting
      rateLimitService.reset();
      Logger.info('[SoundCloud] Rate limit reset. Resuming requests with full allocation.');
    }
  }

  async createPlaylist(title: string, description: string = '', isPrivate: boolean = false) {
    try {
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        throw new Error('Playlist title is required and must be a non-empty string');
      }

      if (title.length > 255) {
        throw new Error('Playlist title must be less than 255 characters');
      }

      if (description && description.length > 1000) {
        throw new Error('Playlist description must be less than 1000 characters');
      }

      // SoundCloud API requires body wrapped in 'playlist' object
      const response = await this.client.post('/playlists', {
        playlist: {
          title: title.trim(),
          description: description.trim(),
          sharing: isPrivate ? 'private' : 'public',
        },
      });

      const playlist = response.data;
      if (!playlist || !playlist.id) {
        Logger.error(`[SoundCloud] Playlist created but no ID found in response: ${JSON.stringify(playlist)}`);
        throw new Error(`Failed to extract playlist ID from SoundCloud response`);
      }

      return playlist;
    } catch (error) {
      this.handleError(error, `createPlaylist(${title})`);
    }
  }

  async createPlaylistWithTracks(
    title: string,
    trackIds: string[],
    description: string = '',
    isPrivate: boolean = false
  ) {
    try {
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        throw new Error('Playlist title is required and must be a non-empty string');
      }

      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        throw new Error('Track IDs must be a non-empty array');
      }

      // Filter out empty track IDs and log if any are removed
      const validTrackIds = trackIds.filter(id => typeof id === 'string' && id.trim().length > 0);
      
      if (validTrackIds.length === 0) {
        throw new Error('No valid track IDs found');
      }

      if (validTrackIds.length < trackIds.length) {
        Logger.warn(`[SoundCloud] Filtered out ${trackIds.length - validTrackIds.length} invalid track IDs`);
      }

      // SoundCloud API supports creating playlist with initial tracks in single request
      const response = await this.client.post('/playlists', {
        playlist: {
          title: title.trim(),
          description: description.trim(),
          sharing: isPrivate ? 'private' : 'public',
          tracks: validTrackIds.map(id => ({ id })),
        },
      });

      const playlist = response.data;
      if (!playlist || !playlist.id) {
        Logger.error(`[SoundCloud] Playlist created but no ID found in response: ${JSON.stringify(playlist)}`);
        throw new Error(`Failed to extract playlist ID from SoundCloud response`);
      }

      return playlist;
    } catch (error) {
      this.handleError(error, `createPlaylistWithTracks(${title}, ${trackIds.length} tracks)`);
    }
  }

  async addTrackToPlaylist(playlistId: string, trackId: string) {
    try {
      if (!playlistId || typeof playlistId !== 'string') {
        throw new Error('Invalid playlist ID: must be a non-empty string');
      }

      if (!trackId || typeof trackId !== 'string') {
        throw new Error('Invalid track ID: must be a non-empty string');
      }

      // SoundCloud API requires tracks wrapped in 'playlist' object
      const response = await this.client.put(`/playlists/${playlistId}`, {
        playlist: {
          tracks: [{ id: trackId }],
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `addTrackToPlaylist(${playlistId}, ${trackId})`);
    }
  }

  async addTracksToPlaylist(playlistId: string, trackIds: string[]) {
    try {
      if (!playlistId || typeof playlistId !== 'string') {
        throw new Error('Invalid playlist ID: must be a non-empty string');
      }

      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        throw new Error('Track IDs must be a non-empty array');
      }

      // Filter out empty track IDs
      const validTrackIds = trackIds.filter(id => typeof id === 'string' && id.trim().length > 0);
      
      if (validTrackIds.length === 0) {
        throw new Error('No valid track IDs found');
      }

      if (validTrackIds.length < trackIds.length) {
        Logger.warn(`[SoundCloud] Filtered out ${trackIds.length - validTrackIds.length} invalid track IDs`);
      }

      // SoundCloud API supports adding multiple tracks in single request
      const response = await this.client.put(`/playlists/${playlistId}`, {
        playlist: {
          tracks: validTrackIds.map(id => ({ id })),
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `addTracksToPlaylist(${playlistId}, ${trackIds.length} tracks)`);
    }
  }

  async searchTrack(query: string, limit: number = 10) {
    try {
      if (typeof query !== 'string') {
        throw new Error('Invalid query: must be a string');
      }

      if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
        throw new Error('Invalid limit: must be an integer between 1 and 200');
      }

      const response = await this.client.get('/tracks', {
        params: {
          q: query,
          limit,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `searchTrack(${query})`);
    }
  }

  async getPlaylist(playlistId: string) {
    try {
      if (!playlistId || typeof playlistId !== 'string') {
        throw new Error('Invalid playlist ID: must be a non-empty string');
      }

      const response = await this.client.get(`/playlists/${playlistId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `getPlaylist(${playlistId})`);
    }
  }
}
