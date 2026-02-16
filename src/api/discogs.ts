import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';

export class DiscogsAPIClientError extends Error {
  constructor(
    public statusCode?: number,
    public originalError?: any,
    message?: string,
    public rateLimitResetTime?: Date
  ) {
    super(message || 'Discogs API Error');
    this.name = 'DiscogsAPIClientError';
  }
}

export class DiscogsAPIClient {
  private client: AxiosInstance;
  private token: string;
  private username: string;
  private rateLimitResetTime?: Date;

  constructor(token: string, username: string) {
    if (!token || !username) {
      throw new Error('Discogs API requires both token and username');
    }

    this.token = token;
    this.username = username;

    this.client = axios.create({
      baseURL: 'https://api.discogs.com',
      headers: {
        'User-Agent': 'DiscogsManager/1.0',
        Authorization: `Discogs token=${token}`,
      },
      timeout: 30000, // 30 second timeout
    });

    // Apply axios-retry with exponential backoff
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        // Retry on 5xx errors and 429 (rate limit)
        // Don't retry on 4xx errors (except 429)
        if (!error.response) return true; // Retry network errors
        const status = error.response.status;
        return status === 429 || (status >= 500 && status < 600);
      },
    });
  }

  private extractRateLimitInfo(error: any): { resetTime?: Date; remaining?: number } {
    const headers = error.response?.headers;
    if (!headers) return {};

    const result: { resetTime?: Date; remaining?: number } = {};

    // Parse X-RateLimit-Reset header (Unix timestamp)
    const resetTimestamp = headers['x-ratelimit-reset'];
    if (resetTimestamp) {
      result.resetTime = new Date(parseInt(resetTimestamp) * 1000);
      this.rateLimitResetTime = result.resetTime;
    }

    // Parse X-RateLimit-Remaining header
    const remaining = headers['x-ratelimit-remaining'];
    if (remaining) {
      result.remaining = parseInt(remaining);
    }

    return result;
  }

  private handleError(error: any, context: string): never {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data as any;
      const rateLimitInfo = this.extractRateLimitInfo(axiosError);

      switch (status) {
        case 401:
          throw new DiscogsAPIClientError(401, error, `Authentication failed: ${context}. Invalid token or username.`);
        case 404:
          throw new DiscogsAPIClientError(404, error, `Not found: ${context}. The requested resource does not exist.`);
        case 429:
          throw new DiscogsAPIClientError(
            429,
            error,
            `Rate limit exceeded: ${context}. Please try again later.${
              rateLimitInfo.resetTime ? ` Reset at: ${rateLimitInfo.resetTime.toISOString()}` : ''
            }`,
            rateLimitInfo.resetTime
          );
        case 500:
        case 502:
        case 503:
          throw new DiscogsAPIClientError(status, error, `Server error (${status}): ${context}. Please try again later.`);
        default:
          throw new DiscogsAPIClientError(status, error, `API error (${status}): ${context}. ${data?.message || ''}`);
      }
    }

    if (axiosError.code === 'ECONNABORTED') {
      throw new DiscogsAPIClientError(undefined, error, `Request timeout: ${context}. The server took too long to respond.`);
    }

    if (axiosError.code === 'ENOTFOUND') {
      throw new DiscogsAPIClientError(undefined, error, `Network error: ${context}. Unable to reach the Discogs API.`);
    }

    throw new DiscogsAPIClientError(undefined, error, `Unexpected error in ${context}: ${error.message}`);
  }

  async getCollection(username: string = this.username, page: number = 1) {
    try {
      if (!username || typeof username !== 'string') {
        throw new Error('Invalid username provided');
      }

      if (!Number.isInteger(page) || page < 1) {
        throw new Error('Invalid page number: must be a positive integer');
      }

      const response = await this.client.get(`/users/${username}/collection/folders/0/releases`, {
        params: {
          page,
          per_page: 50, // Discogs API max per page
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `getCollection(${username}, page ${page})`);
    }
  }

  async getCollectionPaginated(username: string = this.username) {
    try {
      if (!username || typeof username !== 'string') {
        throw new Error('Invalid username provided');
      }

      const allReleases = [];
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await this.getCollection(username, page);
        
        if (response.releases && Array.isArray(response.releases)) {
          allReleases.push(...response.releases);
        }

        // Check if there are more pages
        if (response.pagination) {
          hasMorePages = page < response.pagination.pages;
          page++;
        } else {
          hasMorePages = false;
        }
      }

      return {
        releases: allReleases,
        pagination: {
          pages: page - 1,
          items: allReleases.length,
          per_page: 50,
        },
      };
    } catch (error) {
      this.handleError(error, `getCollectionPaginated(${username})`);
    }
  }

  async getRelease(releaseId: number) {
    try {
      if (!Number.isInteger(releaseId) || releaseId <= 0) {
        throw new Error('Invalid release ID: must be a positive integer');
      }

      const response = await this.client.get(`/releases/${releaseId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `getRelease(${releaseId})`);
    }
  }

  async searchRelease(query: string, limit: number = 10) {
    try {
      if (typeof query !== 'string') {
        throw new Error('Invalid query: must be a string');
      }

      if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
        throw new Error('Invalid limit: must be an integer between 1 and 100');
      }

      const response = await this.client.get('/database/search', {
        params: {
          q: query,
          type: 'release',
          per_page: limit,
        },
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `searchRelease(${query})`);
    }
  }
}
