import axios, { AxiosInstance } from 'axios';

export class DiscogsAPIClient {
  private client: AxiosInstance;
  private token: string;
  private username: string;

  constructor(token: string, username: string) {
    this.token = token;
    this.username = username;

    this.client = axios.create({
      baseURL: 'https://api.discogs.com',
      headers: {
        'User-Agent': 'DiscogsManager/1.0',
        Authorization: `Discogs token=${token}`,
      },
    });
  }

  async getCollection(username: string = this.username) {
    try {
      const response = await this.client.get(`/users/${username}/collection/folders/0/releases`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch collection: ${error}`);
    }
  }

  async getRelease(releaseId: number) {
    try {
      const response = await this.client.get(`/releases/${releaseId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch release ${releaseId}: ${error}`);
    }
  }

  async searchRelease(query: string, limit: number = 10) {
    try {
      const response = await this.client.get('/database/search', {
        params: {
          q: query,
          type: 'release',
          per_page: limit,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search releases: ${error}`);
    }
  }
}
