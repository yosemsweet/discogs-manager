import { PlaylistService } from '../src/services/playlist';
import { DatabaseManager } from '../src/services/database';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { StoredRelease } from '../src/types';
import { SOUNDCLOUD_PLAYLIST_TRACK_LIMIT } from '../src/services/playlist-batch';

// Mock the SoundCloud API client
jest.mock('../src/api/soundcloud');
// Mock the track search service to return a controlled set of matched tracks
jest.mock('../src/services/track-search');

import { TrackSearchService } from '../src/services/track-search';

const MockedTrackSearchService = TrackSearchService as jest.MockedClass<typeof TrackSearchService>;

function makeRelease(id: number, addedAt: Date = new Date()): StoredRelease {
  return {
    discogsId: id,
    title: `Release ${id}`,
    artists: `Artist ${id}`,
    year: 2020,
    genres: 'Electronic',
    styles: 'Synth-pop',
    condition: 'Mint',
    rating: 4,
    addedAt,
  };
}

const MAX_RELEASE_ID = 20;

function makeTrackData(
  count: number,
  opts: { confidenceBase?: number; stepDown?: number } = {}
): Array<{ trackId: string; discogsId: number; confidence: number }> {
  const base = opts.confidenceBase ?? 0.9;
  const step = opts.stepDown ?? 0.001;
  return Array.from({ length: count }, (_, i) => ({
    trackId: `sc-track-${i + 1}`,
    // Cycle through the seeded release IDs (1–MAX_RELEASE_ID)
    discogsId: (i % MAX_RELEASE_ID) + 1,
    confidence: Math.max(0, base - i * step),
  }));
}

describe('playlist track limit enforcement', () => {
  let db: DatabaseManager;
  let mockClient: jest.Mocked<SoundCloudAPIClient>;
  let service: PlaylistService;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;

    // Pre-insert releases 1–20 so FK constraints pass
    for (let i = 1; i <= 20; i++) {
      await db.addRelease(makeRelease(i));
    }

    mockClient = new (SoundCloudAPIClient as any)() as jest.Mocked<SoundCloudAPIClient>;
    mockClient.createPlaylistWithTracks = jest.fn().mockResolvedValue({ id: 'sc-playlist-1' });
    mockClient.addTracksToPlaylist = jest.fn().mockResolvedValue({});
    mockClient.getPlaylist = jest.fn().mockResolvedValue({ id: 'sc-playlist-1' });

    // Replace the TrackSearchService prototype so PlaylistService uses our mock
    MockedTrackSearchService.prototype.searchTracksForReleases = jest.fn();

    service = new PlaylistService(mockClient, db);
  });

  afterEach(async () => {
    await db.close();
  });

  test('SOUNDCLOUD_PLAYLIST_TRACK_LIMIT constant equals 500', () => {
    expect(SOUNDCLOUD_PLAYLIST_TRACK_LIMIT).toBe(500);
  });

  test('300 matched tracks — all 300 sent, no excluded saved', async () => {
    const releases = Array.from({ length: 10 }, (_, i) => makeRelease(i + 1));
    const trackData = makeTrackData(300);
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    const result = await service.createPlaylist('Test Playlist', releases);

    expect(result.trackCount).toBe(300);
    expect(result.excludedCount).toBe(0);
    expect(mockClient.createPlaylistWithTracks).toHaveBeenCalledWith(
      'Test Playlist',
      expect.arrayContaining([expect.any(String)]),
      '',
      false
    );
    const included = (mockClient.createPlaylistWithTracks as jest.Mock).mock.calls[0][1];
    expect(included).toHaveLength(300);

    const excluded = await db.getExcludedTracks('Test Playlist');
    expect(excluded).toHaveLength(0);
  });

  test('500 matched tracks — all 500 sent, no excluded saved', async () => {
    const releases = Array.from({ length: 10 }, (_, i) => makeRelease(i + 1));
    const trackData = makeTrackData(500);
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    const result = await service.createPlaylist('Test Playlist', releases);

    expect(result.trackCount).toBe(500);
    expect(result.excludedCount).toBe(0);
    const excluded = await db.getExcludedTracks('Test Playlist');
    expect(excluded).toHaveLength(0);
  });

  test('501 matched tracks — 500 sent, 1 excluded', async () => {
    const releases = Array.from({ length: 10 }, (_, i) => makeRelease(i + 1));
    const trackData = makeTrackData(501);
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    const result = await service.createPlaylist('Test Playlist', releases);

    expect(result.trackCount).toBe(500);
    expect(result.excludedCount).toBe(1);
    const excluded = await db.getExcludedTracks('Test Playlist');
    expect(excluded).toHaveLength(1);
  });

  test('959 matched tracks — 500 sent, 459 excluded', async () => {
    const releases = Array.from({ length: 20 }, (_, i) => makeRelease(i + 1));
    const trackData = makeTrackData(959);
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    const result = await service.createPlaylist('Test Playlist', releases);

    expect(result.trackCount).toBe(500);
    expect(result.excludedCount).toBe(459);
    const excluded = await db.getExcludedTracks('Test Playlist');
    expect(excluded).toHaveLength(459);
  });

  test('--limit 200 with 500 matched tracks: 200 sent, 300 excluded', async () => {
    const releases = Array.from({ length: 10 }, (_, i) => makeRelease(i + 1));
    const trackData = makeTrackData(500);
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    const result = await service.createPlaylist('Test Playlist', releases, undefined, undefined, 200);

    expect(result.trackCount).toBe(200);
    expect(result.excludedCount).toBe(300);
    const excluded = await db.getExcludedTracks('Test Playlist');
    expect(excluded).toHaveLength(300);
  });
});
