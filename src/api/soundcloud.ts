import axios, { AxiosInstance, AxiosError } from 'axios';

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

export class SoundCloudAPIClient {
  private client: AxiosInstance;
  private clientId: string;
  private userToken: string;

  constructor(clientId: string, userToken: string) {
    if (!clientId || !userToken) {
      throw new Error('SoundCloud API requires both clientId and userToken');
    }

    this.clientId = clientId;
    this.userToken = userToken;

    this.client = axios.create({
      baseURL: 'https://api.soundcloud.com',
      params: {
        client_id: clientId,
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
          throw new SoundCloudAPIClientError(429, error, `Rate limit exceeded in ${context}: Please try again later`);
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

      const response = await this.client.post('/me/playlists', {
        title: title.trim(),
        description: description.trim(),
        sharing: isPrivate ? 'private' : 'public',
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `createPlaylist(${title})`);
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

      const response = await this.client.put(`/playlists/${playlistId}`, {
        tracks: [{ id: trackId }],
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `addTrackToPlaylist(${playlistId}, ${trackId})`);
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
