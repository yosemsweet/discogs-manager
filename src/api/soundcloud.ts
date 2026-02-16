import axios, { AxiosInstance } from 'axios';

export class SoundCloudAPIClient {
  private client: AxiosInstance;
  private clientId: string;
  private userToken: string;

  constructor(clientId: string, userToken: string) {
    this.clientId = clientId;
    this.userToken = userToken;

    this.client = axios.create({
      baseURL: 'https://api.soundcloud.com',
      params: {
        client_id: clientId,
      },
    });
  }

  async createPlaylist(title: string, description: string = '', isPrivate: boolean = false) {
    try {
      const response = await this.client.post('/me/playlists', {
        title,
        description,
        sharing: isPrivate ? 'private' : 'public',
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create playlist: ${error}`);
    }
  }

  async addTrackToPlaylist(playlistId: string, trackId: string) {
    try {
      const response = await this.client.put(`/playlists/${playlistId}`, {
        tracks: [{ id: trackId }],
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to add track to playlist: ${error}`);
    }
  }

  async searchTrack(query: string, limit: number = 10) {
    try {
      const response = await this.client.get('/tracks', {
        params: {
          q: query,
          limit,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search tracks: ${error}`);
    }
  }

  async getPlaylist(playlistId: string) {
    try {
      const response = await this.client.get(`/playlists/${playlistId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch playlist: ${error}`);
    }
  }
}
