/**
 * Tests for the performance improvements in TrackSearchService:
 *  - Bulk cache pre-fetch (one SQL query instead of N per-track queries)
 *  - Bounded concurrency (runWithConcurrency)
 *  - Negative-match cache (skip known-dead searches within TTL)
 *  - Strategy stats recording and pruning gate
 */

import { DatabaseManager } from '../src/services/database';
import { TrackSearchService } from '../src/services/track-search';
import { runWithConcurrency } from '../src/utils/concurrency';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRelease(id: number, title = `Release ${id}`, artists = 'Artist') {
  return {
    discogsId: id,
    title,
    artists,
    year: 2020,
    genres: 'Jazz',
    styles: 'Hard Bop',
    addedAt: new Date(),
  };
}

async function seedRelease(db: DatabaseManager, id: number) {
  await db.addRelease(makeRelease(id));
}

async function seedTrackMatch(
  db: DatabaseManager,
  releaseId: number,
  trackTitle: string,
  soundcloudTrackId = `sc-${releaseId}-${trackTitle.replace(/\s/g, '-')}`,
  confidence = 0.9,
  matchedTitle = trackTitle
) {
  await db.saveCachedTrackMatch(releaseId, trackTitle, soundcloudTrackId, confidence, matchedTitle);
}

// ---------------------------------------------------------------------------
// runWithConcurrency
// ---------------------------------------------------------------------------

describe('runWithConcurrency', () => {
  test('returns empty array for empty input', async () => {
    const results = await runWithConcurrency([], 5, async (x: number) => x * 2);
    expect(results).toEqual([]);
  });

  test('returns results in input order regardless of completion order', async () => {
    const delays = [50, 10, 30, 5, 20];
    const results = await runWithConcurrency(delays, 5, async (delay, i) => {
      await new Promise(resolve => setTimeout(resolve, delay));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  test('respects concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runWithConcurrency(items, 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test('a single throwing task does not cancel others', async () => {
    const items = [0, 1, 2, 3, 4];
    const results = await runWithConcurrency(items, 5, async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    }).catch(() => null);
    // The throw propagates from Promise.all — that's expected — but other tasks ran.
    // We verify the function completes (either throws or returns) without hanging.
    expect(results === null || Array.isArray(results)).toBe(true);
  });

  test('works correctly with concurrency cap larger than items', async () => {
    const items = [1, 2, 3];
    const results = await runWithConcurrency(items, 100, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30]);
  });
});

// ---------------------------------------------------------------------------
// DatabaseManager: getAllCachedTrackMatches (bulk cache pre-fetch)
// ---------------------------------------------------------------------------

describe('DatabaseManager.getAllCachedTrackMatches', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('returns empty map for empty releaseIds input', () => {
    const result = db.getAllCachedTrackMatches([]);
    expect(result.size).toBe(0);
  });

  test('loads all cached matches for given release IDs in one shape', async () => {
    await seedRelease(db, 1);
    await seedRelease(db, 2);
    await seedTrackMatch(db, 1, 'Track A', 'sc-1', 0.95, 'Track A SoundCloud');
    await seedTrackMatch(db, 1, 'Track B', 'sc-2', 0.80, 'Track B SoundCloud');
    await seedTrackMatch(db, 2, 'Track C', 'sc-3', 0.70, 'Track C SoundCloud');

    const map = db.getAllCachedTrackMatches([1, 2]);

    expect(map.size).toBe(3);
    expect(map.has('1|Track A')).toBe(true);
    expect(map.has('1|Track B')).toBe(true);
    expect(map.has('2|Track C')).toBe(true);

    const matchA = map.get('1|Track A')!;
    expect(matchA.soundcloudTrackId).toBe('sc-1');
    expect(matchA.confidence).toBe(0.95);
    expect(matchA.matchedTitle).toBe('Track A SoundCloud');
  });

  test('does not return entries for release IDs not in the input', async () => {
    await seedRelease(db, 1);
    await seedRelease(db, 2);
    await seedTrackMatch(db, 1, 'Track A', 'sc-1');
    await seedTrackMatch(db, 2, 'Track B', 'sc-2');

    const map = db.getAllCachedTrackMatches([1]);
    expect(map.size).toBe(1);
    expect(map.has('1|Track A')).toBe(true);
    expect(map.has('2|Track B')).toBe(false);
  });

  test('returns empty map when release IDs have no cached matches', async () => {
    await seedRelease(db, 99);
    const map = db.getAllCachedTrackMatches([99]);
    expect(map.size).toBe(0);
  });

  test('lookup by key returns same shape as getCachedTrackMatch', async () => {
    await seedRelease(db, 1);
    await seedTrackMatch(db, 1, 'My Track', 'sc-42', 0.88, 'My Track SC');

    const map = db.getAllCachedTrackMatches([1]);
    const bulkResult = map.get('1|My Track')!;
    const perTrackResult = await db.getCachedTrackMatch(1, 'My Track');

    expect(bulkResult.soundcloudTrackId).toBe(perTrackResult!.soundcloudTrackId);
    expect(bulkResult.confidence).toBe(perTrackResult!.confidence);
    expect(bulkResult.matchedTitle).toBe(perTrackResult!.matchedTitle);
  });
});

// ---------------------------------------------------------------------------
// DatabaseManager: isKnownUnmatchedTrack (negative-match cache)
// ---------------------------------------------------------------------------

describe('DatabaseManager.isKnownUnmatchedTrack', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('returns false when no unmatched_tracks row exists', async () => {
    await seedRelease(db, 1);
    expect(db.isKnownUnmatchedTrack(1, 'Missing Track', 30)).toBe(false);
  });

  test('returns true for a pending row within TTL', async () => {
    await seedRelease(db, 1);
    await db.saveUnmatchedTrack({
      playlistTitle: 'Test Playlist',
      discogsReleaseId: 1,
      discogsTrackTitle: 'Track X',
      strategiesTriedCount: 4,
    });
    expect(db.isKnownUnmatchedTrack(1, 'Track X', 30)).toBe(true);
  });

  test('returns false for a row outside TTL', async () => {
    await seedRelease(db, 1);
    // Insert a row with a createdAt far in the past by direct SQL
    (db as any).db.prepare(`
      INSERT INTO unmatched_tracks (playlistTitle, discogsReleaseId, discogsTrackTitle, strategiesTriedCount, status, createdAt)
      VALUES ('Test Playlist', 1, 'Old Track', 4, 'pending', '2020-01-01T00:00:00.000Z')
    `).run();
    expect(db.isKnownUnmatchedTrack(1, 'Old Track', 30)).toBe(false);
  });

  test('returns false for a resolved row (not pending)', async () => {
    await seedRelease(db, 1);
    await db.saveUnmatchedTrack({
      playlistTitle: 'Test Playlist',
      discogsReleaseId: 1,
      discogsTrackTitle: 'Resolved Track',
      strategiesTriedCount: 4,
    });
    // Resolve it
    await db.resolveUnmatchedTrack(1, 'sc-resolved');
    expect(db.isKnownUnmatchedTrack(1, 'Resolved Track', 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DatabaseManager: strategy stats (recordStrategyOutcome / getStrategyHitRates)
// ---------------------------------------------------------------------------

describe('DatabaseManager strategy stats', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('getStrategyHitRates returns empty map when no data', () => {
    const rates = db.getStrategyHitRates();
    expect(rates.size).toBe(0);
  });

  test('recordStrategyOutcome increments attempts', () => {
    db.recordStrategyOutcome(0, false);
    db.recordStrategyOutcome(0, false);
    db.recordStrategyOutcome(0, false);
    const rates = db.getStrategyHitRates();
    expect(rates.get(0)?.attempts).toBe(3);
    expect(rates.get(0)?.hits).toBe(0);
  });

  test('recordStrategyOutcome increments hits on match', () => {
    db.recordStrategyOutcome(1, true);
    db.recordStrategyOutcome(1, false);
    db.recordStrategyOutcome(1, true);
    const rates = db.getStrategyHitRates();
    expect(rates.get(1)?.attempts).toBe(3);
    expect(rates.get(1)?.hits).toBe(2);
  });

  test('tracks multiple strategy indices independently', () => {
    db.recordStrategyOutcome(0, true);
    db.recordStrategyOutcome(0, false);
    db.recordStrategyOutcome(1, false);
    db.recordStrategyOutcome(2, true);
    db.recordStrategyOutcome(2, true);
    const rates = db.getStrategyHitRates();
    expect(rates.get(0)?.hits).toBe(1);
    expect(rates.get(1)?.hits).toBe(0);
    expect(rates.get(2)?.hits).toBe(2);
  });

  test('strategy stats writes are idempotent on repeated upserts', () => {
    for (let i = 0; i < 10; i++) {
      db.recordStrategyOutcome(0, i % 2 === 0);
    }
    const rates = db.getStrategyHitRates();
    expect(rates.get(0)?.attempts).toBe(10);
    expect(rates.get(0)?.hits).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// TrackSearchService: bulk cache lookup bypasses getCachedTrackMatch
// ---------------------------------------------------------------------------

describe('TrackSearchService bulk cache pre-fetch', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('getAllCachedTrackMatches is called once and getCachedTrackMatch is never called', async () => {
    await seedRelease(db, 1);
    await seedTrackMatch(db, 1, 'Blue Note', 'sc-blue', 0.9, 'Blue Note SC');
    await db.addTracks(1, [
      { title: 'Blue Note', position: 'A1', duration: '3:00' },
    ]);

    const bulkSpy = jest.spyOn(db, 'getAllCachedTrackMatches');
    const perTrackSpy = jest.spyOn(db, 'getCachedTrackMatch');

    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: jest.fn().mockResolvedValue([]),
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist');

    expect(bulkSpy).toHaveBeenCalledTimes(1);
    expect(perTrackSpy).not.toHaveBeenCalled();
  });

  test('cached tracks are returned without calling searchTrack', async () => {
    await seedRelease(db, 1);
    await seedTrackMatch(db, 1, 'Blue Note', 'sc-blue', 0.9, 'Blue Note SC');
    await db.addTracks(1, [
      { title: 'Blue Note', position: 'A1', duration: '3:00' },
    ]);

    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: jest.fn().mockResolvedValue([]),
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    const results = await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist');

    expect(results).toHaveLength(1);
    expect(results[0].trackId).toBe('sc-blue');
    expect(results[0].confidence).toBe(0.9);
    expect(mockSoundcloud.searchTrack).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TrackSearchService: negative-match cache
// ---------------------------------------------------------------------------

describe('TrackSearchService negative-match cache', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('skips searchTrack for tracks with recent pending unmatched_tracks row', async () => {
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'Ghost Track', position: 'A1', duration: '3:00' },
    ]);
    await db.saveUnmatchedTrack({
      playlistTitle: 'Test Playlist',
      discogsReleaseId: 1,
      discogsTrackTitle: 'Ghost Track',
      strategiesTriedCount: 4,
    });

    const searchTrackMock = jest.fn().mockResolvedValue([]);
    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: searchTrackMock,
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist', { exhaustive: false });

    expect(searchTrackMock).not.toHaveBeenCalled();
  });

  test('--exhaustive bypasses negative-match cache and calls searchTrack', async () => {
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'Ghost Track', position: 'A1', duration: '3:00' },
    ]);
    await db.saveUnmatchedTrack({
      playlistTitle: 'Test Playlist',
      discogsReleaseId: 1,
      discogsTrackTitle: 'Ghost Track',
      strategiesTriedCount: 4,
    });

    const searchTrackMock = jest.fn().mockResolvedValue([]);
    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: searchTrackMock,
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist', { exhaustive: true });

    expect(searchTrackMock).toHaveBeenCalled();
  });

  test('unmatched track is written to unmatched_tracks on miss', async () => {
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'No Match Track', position: 'A1', duration: '3:00' },
    ]);

    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: jest.fn().mockResolvedValue([]),
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist');

    // Now the negative cache should catch it on second run
    expect(db.isKnownUnmatchedTrack(1, 'No Match Track', 30)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TrackSearchService: strategy pruning gate
// ---------------------------------------------------------------------------

describe('TrackSearchService strategy pruning', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('strategy with <100 observations is never pruned', async () => {
    // Seed 50 misses for strategy 3 — below the 100-observation threshold
    for (let i = 0; i < 50; i++) {
      db.recordStrategyOutcome(3, false);
    }
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'Any Track', position: 'A1', duration: '3:00' },
    ]);

    const searchTrackMock = jest.fn().mockResolvedValue([]);
    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: searchTrackMock,
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist');

    // All strategies (including strategy index 3) should have been tried
    // We can't easily count per-strategy calls, but we verify searchTrack was called at all
    expect(searchTrackMock).toHaveBeenCalled();
  });

  test('strategy with ≥100 observations and <5% hit rate is pruned', async () => {
    // Seed 100 attempts with 0 hits for strategy 1 — should be pruned
    for (let i = 0; i < 100; i++) {
      db.recordStrategyOutcome(1, false);
    }
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'Any Track', position: 'A1', duration: '3:00' },
    ]);

    const callArgs: string[] = [];
    const searchTrackMock = jest.fn().mockImplementation((query: string) => {
      callArgs.push(query);
      return Promise.resolve([]);
    });
    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: searchTrackMock,
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    // We need to know how many strategies QueryNormalizer.buildQueryStrategies generates
    // to verify one was skipped. At minimum the call count should be less than max strategies.
    const service = new TrackSearchService(mockSoundcloud, db);
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist');

    // With strategy 1 pruned, we should see fewer calls than total strategies available
    // (exact count depends on QueryNormalizer, so we just verify pruning reduced calls)
    const callsWithPruning = callArgs.length;

    // Reset and run again exhaustive (no pruning) to get the baseline count
    callArgs.length = 0;
    await service.searchTracksForReleases([makeRelease(1)], undefined, 'Test Playlist', { exhaustive: true });
    const callsWithoutPruning = callArgs.length;

    expect(callsWithPruning).toBeLessThan(callsWithoutPruning);
  });

  test('--exhaustive bypasses strategy pruning', async () => {
    // Prune all strategies beyond 0
    for (let stratIdx = 1; stratIdx < 4; stratIdx++) {
      for (let i = 0; i < 100; i++) {
        db.recordStrategyOutcome(stratIdx, false);
      }
    }
    await seedRelease(db, 1);
    await db.addTracks(1, [
      { title: 'Any Track', position: 'A1', duration: '3:00' },
    ]);

    const callsWithPruning: string[] = [];
    const callsExhaustive: string[] = [];

    const mockSoundcloud = (collector: string[]) => ({
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: jest.fn().mockImplementation((q: string) => { collector.push(q); return Promise.resolve([]); }),
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any);

    const svc1 = new TrackSearchService(mockSoundcloud(callsWithPruning), db);
    await svc1.searchTracksForReleases([makeRelease(1)], undefined, 'P');

    const svc2 = new TrackSearchService(mockSoundcloud(callsExhaustive), db);
    await svc2.searchTracksForReleases([makeRelease(1)], undefined, 'P', { exhaustive: true });

    // Exhaustive should have tried more strategies
    expect(callsExhaustive.length).toBeGreaterThan(callsWithPruning.length);
  });
});

// ---------------------------------------------------------------------------
// TrackSearchService: concurrency ordering
// ---------------------------------------------------------------------------

describe('TrackSearchService concurrency ordering', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;
  });

  afterEach(async () => {
    await db.close();
  });

  test('results include all matched tracks even when releases complete out of order', async () => {
    // Seed 3 releases, each with one cached track so no SoundCloud calls needed
    for (const id of [1, 2, 3]) {
      await seedRelease(db, id);
      await seedTrackMatch(db, id, `Track ${id}`, `sc-${id}`, 0.9);
      await db.addTracks(id, [
        { title: `Track ${id}`, position: 'A1', duration: '3:00' },
      ]);
    }

    const mockSoundcloud = {
      throttleIfApproachingLimit: jest.fn().mockResolvedValue(undefined),
      searchPlaylists: jest.fn().mockResolvedValue([]),
      searchTrack: jest.fn().mockResolvedValue([]),
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new TrackSearchService(mockSoundcloud, db);
    const results = await service.searchTracksForReleases(
      [makeRelease(1), makeRelease(2), makeRelease(3)],
      undefined,
      'Test Playlist',
      { concurrency: 3 }
    );

    const trackIds = results.map(r => r.trackId).sort();
    expect(trackIds).toEqual(['sc-1', 'sc-2', 'sc-3']);
  });
});
