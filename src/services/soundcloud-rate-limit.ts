import { Logger } from '../utils/logger';

export interface SoundCloudRateLimitState {
  remaining: number;
  resetTime: Date;
  maxRequests: number;
  lastUpdated: Date;
}

/**
 * Manages SoundCloud API rate limit state and throttling
 * SoundCloud limits: 15,000 requests per 24-hour rolling window
 */
export class SoundCloudRateLimitService {
  private state: SoundCloudRateLimitState | null = null;
  private readonly MAX_REQUESTS = 15000;
  private readonly WARN_THRESHOLD = 5; // Warn when <= 5 requests remaining

  constructor() {
    this.state = null;
  }

  /**
   * Update rate limit state from API response headers/body
   * Expects ISO 8601 reset time like "2025/02/16 09:49:40 +0000"
   */
  updateFromResponse(remainingRequests: number, resetTimeString: string): void {
    try {
      // Parse reset time string: "yyyy/MM/dd HH:mm:ss Z"
      const resetTime = this.parseResetTime(resetTimeString);
      
      this.state = {
        remaining: remainingRequests,
        resetTime,
        maxRequests: this.MAX_REQUESTS,
        lastUpdated: new Date(),
      };

      Logger.debug(
        `[SoundCloud] Rate limit updated: ${remainingRequests}/${this.MAX_REQUESTS} remaining, ` +
        `reset at ${resetTime.toISOString()}`
      );
    } catch (error) {
      Logger.warn(`Failed to parse SoundCloud reset time: ${resetTimeString}`);
    }
  }

  /**
   * Parse SoundCloud reset time format: "yyyy/MM/dd HH:mm:ss Z"
   * Example: "2025/02/16 09:49:40 +0000"
   */
  private parseResetTime(timeString: string): Date {
    // Remove timezone and parse as UTC
    const cleaned = timeString.replace(/\s[+-]\d{4}$/, '');
    const date = new Date(cleaned);
    
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date format: ${timeString}`);
    }
    
    return date;
  }

  /**
   * Check if approaching rate limit (remaining <= threshold)
   */
  isApproachingLimit(): boolean {
    if (!this.state) return false;
    return this.state.remaining <= this.WARN_THRESHOLD;
  }

  /**
   * Check if rate limit has been exceeded
   */
  isLimitExceeded(): boolean {
    if (!this.state) return false;
    return this.state.remaining <= 0;
  }

  /**
   * Get milliseconds until rate limit resets
   */
  getTimeUntilReset(): number {
    if (!this.state) return 0;
    const now = new Date().getTime();
    const resetTime = this.state.resetTime.getTime();
    return Math.max(0, resetTime - now);
  }

  /**
   * Get current rate limit state
   */
  getState(): SoundCloudRateLimitState | null {
    return this.state;
  }

  /**
   * Check if state is stale (older than 24 hours)
   */
  isStateStale(): boolean {
    if (!this.state) return true;
    const now = new Date().getTime();
    const lastUpdateTime = this.state.lastUpdated.getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    return (now - lastUpdateTime) > ONE_DAY;
  }

  /**
   * Reset to unknown state (useful when unsure about current limits)
   */
  reset(): void {
    this.state = null;
    Logger.debug('[SoundCloud] Rate limit state reset');
  }

  /**
   * Format reset time for user display
   */
  getFormattedResetTime(): string {
    if (!this.state) return 'unknown';
    return this.state.resetTime.toISOString();
  }

  /**
   * Get human-readable time until reset
   */
  getTimeUntilResetHuman(): string {
    const ms = this.getTimeUntilReset();
    if (ms <= 0) return 'now';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
