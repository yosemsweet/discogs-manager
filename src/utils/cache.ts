import { Logger } from './logger';

/**
 * Interface for cached data with metadata
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

/**
 * In-memory caching service with time-based expiration.
 * Supports TTL configuration per-key and includes cache statistics.
 *
 * Default TTL: 24 hours (86400000ms)
 * Use cases: Discogs release data, SoundCloud search results, API responses
 */
export class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0,
  };

  private readonly defaultTTL: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize cache service
   * @param defaultTTLMs Default time-to-live in milliseconds (default: 24 hours)
   * @param enableAutoCleanup Enable periodic cleanup of expired entries (default: true)
   * @param cleanupIntervalMs Cleanup interval in milliseconds (default: 1 hour)
   */
  constructor(
    defaultTTLMs: number = 24 * 60 * 60 * 1000, // 24 hours
    enableAutoCleanup: boolean = true,
    cleanupIntervalMs: number = 60 * 60 * 1000 // 1 hour
  ) {
    this.defaultTTL = defaultTTLMs;

    if (enableAutoCleanup) {
      this.startAutoCleanup(cleanupIntervalMs);
    }

    Logger.debug(`CacheService initialized (TTL: ${this.formatTTL(defaultTTLMs)})`);
  }

  /**
   * Set a value in cache with optional custom TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional custom TTL in milliseconds
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs || this.defaultTTL;
    const now = Date.now();

    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      createdAt: now,
      hits: 0,
    });

    this.stats.sets++;
    Logger.debug(`Cache SET: ${key} (TTL: ${this.formatTTL(ttl)})`);
  }

  /**
   * Get a value from cache, returns null if expired or not found
   * @param key Cache key
   * @returns Cached value or null
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      Logger.debug(`Cache MISS: ${key}`);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      Logger.debug(`Cache EXPIRED: ${key}`);
      return null;
    }

    entry.hits++;
    this.stats.hits++;
    Logger.debug(`Cache HIT: ${key} (hits: ${entry.hits})`);
    return entry.value as T;
  }

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get TTL remaining for a cached entry in milliseconds
   * @param key Cache key
   * @returns Milliseconds remaining, or -1 if not found/expired
   */
  getTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) return -1;

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  /**
   * Delete a specific key from cache
   * @param key Cache key
   * @returns True if key existed and was deleted
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      Logger.debug(`Cache DELETE: ${key}`);
    }
    return deleted;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    Logger.info(`Cache CLEARED: ${size} entries removed`);
  }

  /**
   * Get all keys in cache (including expired ones)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hits: number;
    misses: number;
    evictions: number;
    sets: number;
    hitRate: number;
    size: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      ...this.stats,
      hitRate,
      size: this.cache.size,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    Logger.debug('Cache statistics reset');
  }

  /**
   * Remove all expired entries from cache
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.stats.evictions += removed;
      Logger.debug(`Cache CLEANUP: ${removed} expired entries removed (${this.cache.size} remaining)`);
    }

    return removed;
  }

  /**
   * Start automatic cleanup of expired entries
   * @param intervalMs Interval in milliseconds between cleanups
   */
  private startAutoCleanup(intervalMs: number): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);

    Logger.debug(`Auto-cleanup started (interval: ${this.formatTTL(intervalMs)})`);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      Logger.debug('Auto-cleanup stopped');
    }
  }

  /**
   * Format milliseconds to human-readable TTL string
   */
  private formatTTL(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Destroy cache service and cleanup resources
   */
  destroy(): void {
    this.stopAutoCleanup();
    this.clear();
    Logger.debug('CacheService destroyed');
  }
}
