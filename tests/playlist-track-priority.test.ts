import { PlaylistService } from '../src/services/playlist';
import { DatabaseManager } from '../src/services/database';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { StoredRelease } from '../src/types';

jest.mock('../src/api/soundcloud');
jest.mock('../src/services/track-search');

import { TrackSearchService } from '../src/services/track-search';
const MockedTrackSearchService = TrackSearchService as jest.MockedClass<typeof TrackSearchService>;

function makeRelease(id: number, addedAt: Date): StoredRelease {
  return {
    discogsId: id,
    title: `Release ${id}`,
    artists: `Artist ${id}`,
    year: 2020,
    genres: 'Electronic',
    styles: 'Synth-pop',
    addedAt,
  };
}

describe('playlist track priority — confidence-first with addedAt tie-break', () => {
  let db: DatabaseManager;
  let mockClient: jest.Mocked<SoundCloudAPIClient>;
  let service: PlaylistService;
  let capturedTrackIds: string[] = [];

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;

    // Pre-insert releases 1–10 so FK constraints pass
    for (let i = 1; i <= 10; i++) {
      await db.addRelease(makeRelease(i, new Date()));
    }

    mockClient = new (SoundCloudAPIClient as any)() as jest.Mocked<SoundCloudAPIClient>;
    capturedTrackIds = [];
    mockClient.createPlaylistWithTracks = jest.fn().mockImplementation(
      async (_title: string, ids: string[]) => {
        capturedTrackIds = ids;
        return { id: 'sc-playlist-1' };
      }
    );
    mockClient.addTracksToPlaylist = jest.fn().mockResolvedValue({});
    MockedTrackSearchService.prototype.searchTracksForReleases = jest.fn();

    service = new PlaylistService(mockClient, db);
  });

  afterEach(async () => {
    await db.close();
  });

  test('tracks sorted by confidence desc — highest confidence included first', async () => {
    const releases = [makeRelease(1, new Date('2024-01-01'))];
    // All tracks use discogsId=1 which is seeded
    const trackData = [
      { trackId: 'low-conf', discogsId: 1, confidence: 0.5 },
      { trackId: 'high-conf', discogsId: 1, confidence: 0.95 },
      { trackId: 'mid-conf', discogsId: 1, confidence: 0.75 },
    ];
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    await service.createPlaylist('My Playlist', releases, undefined, undefined, 2);

    // Only top 2 by confidence should be sent
    expect(capturedTrackIds).toHaveLength(2);
    expect(capturedTrackIds[0]).toBe('high-conf');
    expect(capturedTrackIds[1]).toBe('mid-conf');
  });

  test('tie-break by addedAt desc — newest acquisition wins', async () => {
    const olderRelease = makeRelease(1, new Date('2023-01-01'));
    const newerRelease = makeRelease(2, new Date('2024-06-01'));
    const releases = [olderRelease, newerRelease];

    // Both tracks have the same confidence — tie-break by addedAt
    const trackData = [
      { trackId: 'older-track', discogsId: 1, confidence: 0.8 },
      { trackId: 'newer-track', discogsId: 2, confidence: 0.8 },
    ];
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    await service.createPlaylist('My Playlist', releases, undefined, undefined, 1);

    // newer addedAt wins the tie
    expect(capturedTrackIds).toHaveLength(1);
    expect(capturedTrackIds[0]).toBe('newer-track');
  });

  test('deterministic: same input always produces same ordering', async () => {
    const releases = Array.from({ length: 5 }, (_, i) => makeRelease(i + 1, new Date(`2024-0${i + 1}-01`)));

    const trackData = releases.map((r, i) => ({
      trackId: `track-${r.discogsId}`,
      discogsId: r.discogsId,
      confidence: 0.9 - i * 0.1,
    }));
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    // Run twice
    await service.createPlaylist('My Playlist', releases, undefined, undefined, 3);
    const first = [...capturedTrackIds];

    // Reset playlist state
    await db.deletePlaylistData('My Playlist');
    await service.createPlaylist('My Playlist', releases, undefined, undefined, 3);
    const second = [...capturedTrackIds];

    expect(first).toEqual(second);
  });

  test('excluded tracks have lowest confidence scores', async () => {
    const releases = Array.from({ length: 3 }, (_, i) => makeRelease(i + 1, new Date()));

    const trackData = [
      { trackId: 'track-a', discogsId: 1, confidence: 0.95 },
      { trackId: 'track-b', discogsId: 2, confidence: 0.70 },
      { trackId: 'track-c', discogsId: 3, confidence: 0.50 },
    ];
    (MockedTrackSearchService.prototype.searchTracksForReleases as jest.Mock).mockResolvedValue(trackData);

    await service.createPlaylist('My Playlist', releases, undefined, undefined, 2);

    // track-c should be excluded (lowest confidence)
    const excluded = await db.getExcludedTracks('My Playlist');
    expect(excluded).toHaveLength(1);
    expect(excluded[0].soundcloudTrackId).toBe('track-c');
    expect(excluded[0].confidence).toBe(0.50);
  });
});
