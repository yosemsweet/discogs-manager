import { CacheService } from '../src/utils/cache';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService(1000, false); // 1 second TTL, no auto-cleanup for tests
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('set and get', () => {
    test('stores and retrieves a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    test('stores and retrieves complex objects', () => {
      const obj = { id: 1, name: 'test', nested: { data: [1, 2, 3] } };
      cache.set('key1', obj);
      expect(cache.get('key1')).toEqual(obj);
    });

    test('returns null for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    test('returns null for expired entry', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL
      expect(cache.get('key1')).toBe('value1');
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('key1')).toBeNull();
    });

    test('overwrites existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });

    test('uses custom TTL when provided', async () => {
      cache.set('key1', 'value1', 50); // 50ms
      expect(cache.get('key1')).toBe('value1');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cache.get('key1')).toBeNull();
    });

    test('uses default TTL when not provided', async () => {
      const cacheWithShortDefault = new CacheService(100, false);
      cacheWithShortDefault.set('key1', 'value1');
      expect(cacheWithShortDefault.get('key1')).toBe('value1');
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cacheWithShortDefault.get('key1')).toBeNull();
      
      cacheWithShortDefault.destroy();
    });
  });

  describe('has', () => {
    test('returns true for valid entry', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    test('returns false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    test('returns false for expired entry', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.has('key1')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('getTTL', () => {
    test('returns remaining TTL', async () => {
      cache.set('key1', 'value1', 500);
      const ttl = cache.getTTL('key1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(500);
    });

    test('returns -1 for non-existent key', () => {
      expect(cache.getTTL('nonexistent')).toBe(-1);
    });

    test('returns -1 for expired entry', async () => {
      cache.set('key1', 'value1', 100);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.getTTL('key1')).toBe(-1);
    });
  });

  describe('delete', () => {
    test('removes entry from cache', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    test('returns false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    test('removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      expect(cache.size()).toBe(3);
      
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeNull();
    });

    test('clears empty cache without error', () => {
      expect(() => cache.clear()).not.toThrow();
    });
  });

  describe('keys', () => {
    test('returns all keys in cache', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      
      const keys = cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
      expect(keys.length).toBe(3);
    });

    test('returns empty array for empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });

    test('includes expired keys until accessed', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.keys()).toContain('key1');
      
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.keys()).toContain('key1'); // Still in keys
      cache.get('key1'); // Access triggers removal
      expect(cache.keys()).not.toContain('key1');
    });
  });

  describe('size', () => {
    test('returns correct cache size', () => {
      expect(cache.size()).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
      cache.delete('key1');
      expect(cache.size()).toBe(1);
    });
  });

  describe('statistics', () => {
    test('tracks hits and misses', () => {
      cache.set('key1', 'value1');
      
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key2'); // miss
      cache.get('key3'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.sets).toBe(1);
    });

    test('calculates hit rate', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');
      cache.get('key2');
      
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(66.66666666666666); // 2 hits out of 3 total
    });

    test('returns 0 hit rate when no accesses', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    test('resets statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key2');
      
      cache.resetStats();
      const stats = cache.getStats();
      
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });

    test('includes cache size in stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });
  });

  describe('cleanup', () => {
    test('removes expired entries', async () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 500);
      cache.set('key3', 'value3', 100);
      
      expect(cache.size()).toBe(3);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      const removed = cache.cleanup();
      
      expect(removed).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.has('key2')).toBe(true);
    });

    test('returns 0 when no expired entries', () => {
      cache.set('key1', 'value1', 1000);
      const removed = cache.cleanup();
      expect(removed).toBe(0);
    });

    test('updates eviction stats', async () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);
      
      const statsBefore = cache.getStats();
      expect(statsBefore.evictions).toBe(0);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      cache.cleanup();
      
      const statsAfter = cache.getStats();
      expect(statsAfter.evictions).toBe(2);
    });
  });

  describe('auto-cleanup', () => {
    test('automatically removes expired entries', async () => {
      const autoCache = new CacheService(100, true, 150); // 100ms TTL, cleanup every 150ms
      
      autoCache.set('key1', 'value1');
      expect(autoCache.has('key1')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      // Auto-cleanup should have removed it
      expect(autoCache.has('key1')).toBe(false);
      
      autoCache.destroy();
    });

    test('can be stopped', async () => {
      const autoCache = new CacheService(100, true, 150);
      
      autoCache.set('key1', 'value1');
      autoCache.stopAutoCleanup();
      
      await new Promise(resolve => setTimeout(resolve, 200));
      // Entry should still exist (auto-cleanup stopped)
      const keys = autoCache.keys();
      expect(keys.length).toBe(1);
      
      autoCache.destroy();
    });
  });

  describe('concurrent operations', () => {
    test('handles multiple concurrent sets', () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(Promise.resolve(cache.set(`key${i}`, `value${i}`)));
      }
      
      return Promise.all(promises).then(() => {
        expect(cache.size()).toBe(100);
      });
    });

    test('handles mixed concurrent operations', () => {
      for (let i = 0; i < 50; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(Promise.resolve(cache.get(`key${i}`)));
      }
      for (let i = 50; i < 100; i++) {
        promises.push(Promise.resolve(cache.set(`key${i}`, `value${i}`)));
      }
      
      return Promise.all(promises).then(() => {
        expect(cache.size()).toBe(100);
      });
    });
  });

  describe('real-world scenarios', () => {
    test('caches Discogs release data', () => {
      const releaseData = {
        id: 12345,
        title: 'Test Album',
        year: 2023,
        artists: ['Artist1', 'Artist2'],
      };
      
      cache.set('discogs:release:12345', releaseData, 24 * 60 * 60 * 1000);
      const cached = cache.get('discogs:release:12345');
      
      expect(cached).toEqual(releaseData);
      expect(cache.getTTL('discogs:release:12345')).toBeGreaterThan(0);
    });

    test('caches SoundCloud search results', () => {
      const searchResults = [
        { id: 1, title: 'Track 1', duration: 180 },
        { id: 2, title: 'Track 2', duration: 240 },
      ];
      
      cache.set('soundcloud:search:test', searchResults, 12 * 60 * 60 * 1000);
      const cached = cache.get('soundcloud:search:test');
      
      expect(cached).toEqual(searchResults);
      expect(cache.size()).toBe(1);
    });

    test('implements cache invalidation pattern', () => {
      cache.set('user:profile:123', { name: 'John' });
      expect(cache.get('user:profile:123')).not.toBeNull();
      
      // Invalidate after update
      cache.delete('user:profile:123');
      expect(cache.get('user:profile:123')).toBeNull();
    });

    test('implements cache warming pattern', () => {
      const releases = [
        { id: 1, title: 'Album 1' },
        { id: 2, title: 'Album 2' },
        { id: 3, title: 'Album 3' },
      ];
      
      // Pre-populate cache
      releases.forEach(release => {
        cache.set(`release:${release.id}`, release);
      });
      
      // Verify all cached
      expect(cache.size()).toBe(3);
      releases.forEach(release => {
        expect(cache.get(`release:${release.id}`)).toEqual(release);
      });
    });
  });

  describe('memory efficiency', () => {
    test('reclaims memory for large objects', () => {
      const largeObject = { data: new Array(10000).fill('x'.repeat(100)) };
      cache.set('large', largeObject);
      expect(cache.has('large')).toBe(true);
      
      cache.delete('large');
      expect(cache.has('large')).toBe(false);
    });

    test('handles many small entries', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, `value${i}`, 100000);
      }
      
      expect(cache.size()).toBe(1000);
      expect(cache.get('key500')).toBe('value500');
    });
  });
});
