import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { Logger } from '../utils/logger';
import { ErrorHandler, AppError, ErrorContext } from '../utils/error-handler';

/**
 * @deprecated Use AppError from error-handler.ts instead
 * Kept for backwards compatibility with existing code
 */
export class DiscogsAPIClientError extends AppError {
  constructor(
    statusCode?: number,
    originalError?: any,
    message?: string,
    public rateLimitResetTime?: Date
  ) {
    // Map to appropriate error type based on status code
    const errorType = ErrorHandler['parseAxiosError'](
      {
        response: { status: statusCode },
      } as any,
      { operation: 'DiscogsAPI' }
    ).type;

    super(
      errorType,
      message || 'Discogs API Error',
      statusCode,
      originalError,
      { operation: 'DiscogsAPI' }
    );
    this.name = 'DiscogsAPIClientError';
    Object.setPrototypeOf(this, DiscogsAPIClientError.prototype);
  }
}

export class DiscogsAPIClient {
  private client: AxiosInstance;
  private token: string;
  private username: string;
  private rateLimitResetTime?: Date;
  private retryCount: number = 0;

  private lastRateLimitCheck: number = 0;
  private rateLimit: number = 60;
  private rateLimitUsed: number = 0;
  private rateLimitRemaining: number = 60;

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

    // Apply axios-retry with custom logic for rate limiting
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: (retryCount, error) => this.handleRetryDelay(retryCount, error),
      retryCondition: (error) => {
        // Retry on 5xx errors and 429 (rate limit)
        // Don't retry on 4xx errors (except 429)
        if (!error.response) return true; // Retry network errors
        const status = error.response.status;
        return status === 429 || (status >= 500 && status < 600);
      },
      onRetry: (retryCount, error, requestConfig) => {
        if (error.response?.status === 429) {
          const rateLimitInfo = this.extractRateLimitInfo(error);
          Logger.warn(
            `Rate limited (429)! Retry attempt ${retryCount}/3. ` +
            `Remaining: ${rateLimitInfo.remaining ?? 'unknown'}, ` +
            `Reset: ${rateLimitInfo.resetTime?.toISOString() ?? 'unknown'}`
          );
        }
      },
    });
  }

  // Throttle requests if rate limit is low
  private async throttleIfNeeded(headers: any) {
    if (!headers) return;
    // Discogs headers
    const limit = parseInt(headers['x-discogs-ratelimit'] || '60');
    const used = parseInt(headers['x-discogs-ratelimit-used'] || '0');
    const remaining = parseInt(headers['x-discogs-ratelimit-remaining'] || '60');
    this.rateLimit = limit;
    this.rateLimitUsed = used;
    this.rateLimitRemaining = remaining;

    // If remaining is low, pause
    if (remaining <= 2) {
      Logger.warn(
        `Rate limit nearly exhausted: ${remaining} remaining of ${limit}. ` +
        `Pausing requests for 60 seconds to reset window.`
      );
      await new Promise((resolve) => setTimeout(resolve, 60000));
      Logger.info('Resuming requests after rate limit pause.');
    }
  }

  private handleRetryDelay(retryCount: number, error: any): number {
    // For rate limit errors, wait until reset time
    if (error.response?.status === 429) {
      const rateLimitInfo = this.extractRateLimitInfo(error);
      if (rateLimitInfo.resetTime) {
        const now = new Date();
        const waitTime = Math.max(0, rateLimitInfo.resetTime.getTime() - now.getTime());
        Logger.info(
          `Rate limit reset at ${rateLimitInfo.resetTime.toISOString()}. ` +
          `Waiting ${Math.ceil(waitTime / 1000)} seconds before retry...`
        );
        return waitTime;
      }
    }

    // For other errors, use exponential backoff
    return axiosRetry.exponentialDelay(retryCount);
  }

  private extractRateLimitInfo(error: any): { resetTime?: Date; remaining?: number } {
    const headers = error.response?.headers;
    if (!headers) return {};

    const result: { resetTime?: Date; remaining?: number } = {};

    // Parse X-Discogs-Ratelimit-Reset header (Unix timestamp)
    // Try both variations of the header name
    const resetTimestamp = headers['x-discogs-ratelimit-reset'] || headers['x-ratelimit-reset'];
    if (resetTimestamp) {
      result.resetTime = new Date(parseInt(resetTimestamp) * 1000);
      this.rateLimitResetTime = result.resetTime;
    }

    // Parse X-Discogs-Ratelimit-Remaining header
    // Try both variations of the header name
    const remaining = headers['x-discogs-ratelimit-remaining'] || headers['x-ratelimit-remaining'];
    if (remaining) {
      result.remaining = parseInt(remaining);
    }

    return result;
  }

  private handleError(error: any, operation: string): never {
    // Create error context for consistent error tracking
    const context: ErrorContext = {
      operation,
      details: {
        statusCode: error.response?.status,
        headers: error.response?.headers,
        data: error.response?.data,
      },
    };

    // Use centralized error handler to parse and log the error
    const appError = ErrorHandler.parse(error, context);

    // Determine log severity based on whether error is retryable
    const severity = appError.isRetryable() ? 'warn' : 'error';
    ErrorHandler.log(appError, severity);

    // Extract rate limit info for backward compatibility
    if (error.response?.headers) {
      const resetTimestamp =
        error.response.headers['x-discogs-ratelimit-reset'] ||
        error.response.headers['x-ratelimit-reset'];
      if (resetTimestamp) {
        const rateLimitResetTime = new Date(parseInt(resetTimestamp) * 1000);
        if (appError instanceof DiscogsAPIClientError) {
          appError.rateLimitResetTime = rateLimitResetTime;
        }
      }
    }

    throw appError;
  }

  async getCollection(username: string = this.username, page: number = 1) {
    const operation = `getCollection(${username}, page ${page})`;
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
      await this.throttleIfNeeded(response.headers);
      return response.data;
    } catch (error) {
      this.handleError(error, operation);
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
        // ...existing code...
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
      await this.throttleIfNeeded(response.headers);
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
      await this.throttleIfNeeded(response.headers);
      return response.data;
    } catch (error) {
      this.handleError(error, `searchRelease(${query})`);
    }
  }
}
