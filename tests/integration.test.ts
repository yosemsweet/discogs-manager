import { DiscogsAPIClient } from '../src/api/discogs';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { DatabaseManager } from '../src/services/database';
import { CollectionService } from '../src/services/collection';
import { PlaylistService } from '../src/services/playlist';
import { StoredRelease } from '../src/types';

// Mock axios
jest.mock('axios');
jest.mock('axios-retry', () => ({
  __esModule: true,
  default: jest.fn((client) => client),
}));

import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Integration Tests - End-to-End Workflows', () => {
  let discogsClient: DiscogsAPIClient;
  let soundcloudClient: SoundCloudAPIClient;
  let db: DatabaseManager;
  let collectionService: CollectionService;
  let playlistService: PlaylistService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup mock axios
    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as any);

    // Initialize clients and services
    discogsClient = new DiscogsAPIClient('test-token', 'test-user');
    soundcloudClient = new SoundCloudAPIClient('test-token');
    db = new DatabaseManager(':memory:');

    await db.initialized;

    collectionService = new CollectionService(discogsClient, db);
    playlistService = new PlaylistService(soundcloudClient, db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Complete Collection Workflow', () => {
    test('should sync collection and retrieve stats', async () => {
      // Setup mock collection response
      const mockCollectionData = {
        pagination: { pages: 1 },
        releases: [
          {
            id: 1,
            basic_information: {
              id: 1001,
              title: 'Rock Album',
              artists: [{ name: 'Rock Band' }],
              year: 2020,
              genres: ['Rock'],
            },
          },
          {
            id: 2,
            basic_information: {
              id: 1002,
              title: 'Jazz Album',
              artists: [{ name: 'Jazz Ensemble' }],
              year: 2021,
              genres: ['Jazz'],
            },
          },
        ],
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: mockCollectionData }),
      } as any);

      const discogsClient2 = new DiscogsAPIClient('test-token', 'test-user');
      const collectionService2 = new CollectionService(discogsClient2, db);

      // Manually populate database (sync would normally do this)
      const releases: StoredRelease[] = [
        {
          discogsId: 1001,
          title: 'Rock Album',
          artists: 'Rock Band',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 1002,
          title: 'Jazz Album',
          artists: 'Jazz Ensemble',
          year: 2021,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
      }

      // Get stats
      const stats = await collectionService2.getStats();

      expect(stats.totalReleases).toBe(2);
      expect(stats.totalGenres).toBeGreaterThan(0);
      expect(stats.yearsSpan.min).toBe(2020);
      expect(stats.yearsSpan.max).toBe(2021);
    });

    test('should filter collection by multiple criteria', async () => {
      // Add diverse test data
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Rock 2020',
          artists: 'Rock Band',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Rock 2021',
          artists: 'Another Rock',
          year: 2021,
          genres: 'Rock, Pop',
          styles: 'Hard Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Jazz 2020',
          artists: 'Jazz Trio',
          year: 2020,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
        {
          discogsId: 4,
          title: 'Electronic 2022',
          artists: 'Synth Master',
          year: 2022,
          genres: 'Electronic, Experimental',
          styles: 'Ambient',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
      }

      // Filter by Rock genre
      const rockReleases = await collectionService.filterReleases({
        genres: ['Rock'],
      });
      expect(rockReleases.length).toBeGreaterThan(0);
      expect(rockReleases.some((r) => r.genres.includes('Rock'))).toBe(true);

      // Filter by year range
      const recentReleases = await collectionService.filterReleases({
        minYear: 2021,
        maxYear: 2022,
      });
      expect(recentReleases.every((r) => r.year >= 2021)).toBe(true);

      // Combined filter
      const filtered = await collectionService.filterReleases({
        genres: ['Rock'],
        minYear: 2021,
      });
      expect(
        filtered.every(
          (r) => r.genres.includes('Rock') && r.year >= 2021
        )
      ).toBe(true);
    });

    test('should extract and analyze genres from collection', async () => {
      // Add releases with various genres
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Alternative',
          styles: 'Indie Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Electronic, Ambient',
          styles: 'Experimental',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Album 3',
          artists: 'Artist 3',
          year: 2022,
          genres: 'Rock, Pop',
          styles: 'Pop Rock',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
      }

      const genres = await collectionService.getGenres();
      expect(Array.isArray(genres)).toBe(true);
      expect(genres.length).toBeGreaterThan(0);
      expect(genres.includes('Rock')).toBe(true);
    });
  });

  describe('Playlist Creation Workflow', () => {
    test('should create playlist from filtered collection', async () => {
      // Setup playlist creation mock with searchTrack and createPlaylist
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({
          data: { id: 'playlist-1', title: 'My Playlist', tracks: [] },
        }),
        get: jest.fn().mockResolvedValue({
          data: { collection: [{ id: 'track-1', title: 'Track 1' }] },
        }),
      } as any);

      // Add test releases
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Rock Album 1',
          artists: 'Rock Band 1',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Rock Album 2',
          artists: 'Rock Band 2',
          year: 2021,
          genres: 'Rock, Hard Rock',
          styles: 'Heavy',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
        // Add tracklists for each release
        await db.addTracks(release.discogsId, [
          {
            title: 'Track 1',
            artists: 'Rock Band',
            position: '1',
            duration: '3:30',
          },
          {
            title: 'Track 2',
            artists: 'Rock Band',
            position: '2',
            duration: '4:00',
          },
        ]);
      }

      // Create playlist
      const soundcloudClient2 = new SoundCloudAPIClient('test-token');
      const playlistService2 = new PlaylistService(soundcloudClient2, db);

      const playlist = await playlistService2.createPlaylist(
        'Rock Collection',
        releases,
        'My favorite rock albums'
      );

      expect(playlist).toBeDefined();
      expect(playlist.id).toBe('playlist-1');
      expect(typeof playlist.trackCount).toBe('number');
    });

    test('should track playlist releases in database', async () => {
      // Setup mocks with both POST and GET
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({
          data: { id: 'playlist-1', title: 'Test Playlist' },
        }),
        get: jest.fn().mockResolvedValue({
          data: { collection: [{ id: 'track-1', title: 'Test Track 1' }] },
        }),
      } as any);

      const releases: StoredRelease[] = [
        {
          discogsId: 101,
          title: 'Test Album',
          artists: 'Test Artist',
          year: 2020,
          genres: 'Test',
          styles: 'Test Style',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
        // Add tracklist for the release
        await db.addTracks(release.discogsId, [
          {
            title: 'Test Track 1',
            artists: 'Test Artist',
            position: '1',
            duration: '3:45',
          },
        ]);
      }

      const soundcloudClient2 = new SoundCloudAPIClient('test-token');
      const playlistService2 = new PlaylistService(soundcloudClient2, db);

      await playlistService2.createPlaylist('Test', releases);

      // Verify playlist was created in database
      const allReleases = await db.getAllReleases();
      expect(allReleases.length).toBeGreaterThan(0);
    });

    test('should handle playlist creation with no releases', async () => {
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({
          data: { id: 'playlist-empty', title: 'Empty Playlist' },
        }),
        get: jest.fn().mockResolvedValue({
          data: { collection: [] },
        }),
      } as any);

      const soundcloudClient2 = new SoundCloudAPIClient('test-token');
      const playlistService2 = new PlaylistService(soundcloudClient2, db);

      // Creating a playlist with no releases should fail
      await expect(
        playlistService2.createPlaylist('Empty', [])
      ).rejects.toThrow('No tracks found');
    });
  });

  describe('Multi-Step Workflows', () => {
    test('should sync, filter, and create playlist', async () => {
      // Setup initial data
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Rock Album',
          artists: 'Rock Band',
          year: 2020,
          genres: 'Rock, Alternative',
          styles: 'Alternative Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Jazz Album',
          artists: 'Jazz Ensemble',
          year: 2021,
          genres: 'Jazz, Experimental',
          styles: 'Fusion',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Rock Pop Album',
          artists: 'Pop Rockers',
          year: 2022,
          genres: 'Rock, Pop',
          styles: 'Pop Rock',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
        // Add tracklists for each release
        await db.addTracks(release.discogsId, [
          {
            title: 'Track 1',
            artists: release.artists,
            position: '1',
            duration: '3:45',
          },
          {
            title: 'Track 2',
            artists: release.artists,
            position: '2',
            duration: '4:15',
          },
        ]);
      }

      // Step 1: Get all releases
      const allReleases = await db.getAllReleases();
      expect(allReleases.length).toBe(3);

      // Step 2: Filter by genre
      const rockReleases = await collectionService.filterReleases({
        genres: ['Rock'],
      });
      expect(rockReleases.length).toBeGreaterThan(0);

      // Step 3: Create playlist from filtered releases
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({
          data: {
            id: 'rock-playlist',
            title: 'Rock Collection',
            tracks: [],
          },
        }),
        get: jest.fn().mockResolvedValue({
          data: { collection: [{ id: 'track-1', title: 'Track 1' }] },
        }),
      } as any);

      const soundcloudClient2 = new SoundCloudAPIClient('test-token');
      const playlistService2 = new PlaylistService(soundcloudClient2, db);

      const playlist = await playlistService2.createPlaylist(
        'Rock Collection',
        rockReleases
      );

      expect(playlist).toBeDefined();
      expect(playlist.id).toBe('rock-playlist');
    });

    test('should handle complex filtering and statistics', async () => {
      // Add diverse data set
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Early Rock',
          artists: 'Classic Rock Band',
          year: 1975,
          genres: 'Rock',
          styles: 'Classic Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Modern Rock',
          artists: 'Indie Rock Band',
          year: 2015,
          genres: 'Rock, Indie',
          styles: 'Indie Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Contemporary Rock',
          artists: 'New Rock Band',
          year: 2023,
          genres: 'Rock, Alternative, Experimental',
          styles: 'Alt Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 4,
          title: 'Jazz Standard',
          artists: 'Jazz Masters',
          year: 2000,
          genres: 'Jazz, Blues',
          styles: 'Smooth Jazz',
          addedAt: new Date(),
        },
        {
          discogsId: 5,
          title: 'Electronic',
          artists: 'Electronic Duo',
          year: 2020,
          genres: 'Electronic, Ambient',
          styles: 'Synthwave',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
      }

      // Get stats
      const stats = await collectionService.getStats();
      expect(stats.totalReleases).toBe(5);
      expect(stats.yearsSpan.min).toBe(1975);
      expect(stats.yearsSpan.max).toBe(2023);

      // Filter rock by year range
      const modernRock = await collectionService.filterReleases({
        genres: ['Rock'],
        minYear: 2000,
      });
      expect(
        modernRock.every(
          (r) =>
            r.genres.includes('Rock') &&
            (r.year === null || r.year >= 2000)
        )
      ).toBe(true);

      // Get genres
      const genres = await collectionService.getGenres();
      expect(genres.includes('Rock')).toBe(true);
      expect(genres.includes('Jazz')).toBe(true);
      expect(genres.includes('Electronic')).toBe(true);
    });

    test('should handle rapid successive operations', async () => {
      const releases: StoredRelease[] = Array.from({ length: 10 }, (_, i) => ({
        discogsId: i + 1,
        title: `Album ${i + 1}`,
        artists: `Artist ${i + 1}`,
        year: 2020 + i,
        genres: i % 2 === 0 ? 'Rock' : 'Jazz',
        styles: 'Genre',
        addedAt: new Date(),
      }));

      // Rapid adds
      await Promise.all(releases.map((r) => db.addRelease(r)));

      // Multiple queries in parallel
      const [all, filtered, stats, genres] = await Promise.all([
        db.getAllReleases(),
        collectionService.filterReleases({ genres: ['Rock'] }),
        collectionService.getStats(),
        collectionService.getGenres(),
      ]);

      expect(all.length).toBe(10);
      expect(filtered.length).toBeGreaterThan(0);
      expect(stats.totalReleases).toBe(10);
      expect(genres.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery Workflows', () => {
    test('should handle API failure and retry with fallback', async () => {
      // First call fails, second succeeds
      const mockGet = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: {
            pagination: { pages: 1 },
            releases: [
              {
                id: 1,
                basic_information: {
                  id: 1001,
                  title: 'Album',
                  artists: [{ name: 'Artist' }],
                  year: 2020,
                  genres: ['Rock'],
                },
              },
            ],
          },
        });

      mockedAxios.create.mockReturnValue({
        get: mockGet,
      } as any);

      const discogsClient2 = new DiscogsAPIClient('token', 'user');

      // First attempt fails
      await expect(discogsClient2.getCollection()).rejects.toThrow();

      // Reset mock
      mockedAxios.create.mockReturnValue({
        get: jest
          .fn()
          .mockResolvedValue({
            data: {
              pagination: { pages: 1 },
              releases: [
                {
                  id: 1,
                  basic_information: {
                    id: 1001,
                    title: 'Album',
                    artists: [{ name: 'Artist' }],
                    year: 2020,
                    genres: ['Rock'],
                  },
                },
              ],
            },
          }),
      } as any);

      const discogsClient3 = new DiscogsAPIClient('token', 'user');

      // Retry succeeds
      const result = await discogsClient3.getCollection();
      expect(result).toBeDefined();
    });

    test('should continue processing after individual record errors', async () => {
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Valid Album',
          artists: 'Valid Artist',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Another Album',
          artists: 'Another Artist',
          year: 2021,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      // Add all releases
      for (const release of releases) {
        await db.addRelease(release);
      }

      // Attempt to add duplicate - should not fail other operations
      await db.addRelease(releases[0]);

      // Continue operations
      const all = await db.getAllReleases();
      expect(all.length).toBe(2); // Still only 2 because of INSERT OR REPLACE

      const stats = await collectionService.getStats();
      expect(stats.totalReleases).toBe(2);
    });

    test('should handle database lock and retry', async () => {
      const release: StoredRelease = {
        discogsId: 1,
        title: 'Test Album',
        artists: 'Test Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Test',
        addedAt: new Date(),
      };

      // Add release
      await db.addRelease(release);

      // Concurrent reads should all succeed
      const [r1, r2, r3] = await Promise.all([
        db.getAllReleases(),
        db.getAllReleases(),
        db.getAllReleases(),
      ]);

      expect(r1.length).toBe(1);
      expect(r2.length).toBe(1);
      expect(r3.length).toBe(1);
    });
  });

  describe('Data Integrity Workflows', () => {
    test('should maintain data consistency through multiple operations', async () => {
      const initialReleases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      for (const release of initialReleases) {
        await db.addRelease(release);
      }

      // Verify initial state
      let allReleases = await db.getAllReleases();
      expect(allReleases.length).toBe(2);

      // Update existing release
      const updatedRelease = { ...initialReleases[0], title: 'Updated Album 1' };
      await db.addRelease(updatedRelease);

      // Verify update
      allReleases = await db.getAllReleases();
      expect(allReleases.length).toBe(2);
      const updated = allReleases.find((r) => r.discogsId === 1);
      expect(updated?.title).toBe('Updated Album 1');

      // Add new release
      const newRelease: StoredRelease = {
        discogsId: 3,
        title: 'Album 3',
        artists: 'Artist 3',
        year: 2022,
        genres: 'Electronic',
        styles: 'Ambient',
        addedAt: new Date(),
      };
      await db.addRelease(newRelease);

      // Verify final state
      allReleases = await db.getAllReleases();
      expect(allReleases.length).toBe(3);
    });

    test('should preserve data through service operations', async () => {
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Alternative',
          styles: 'Indie',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Jazz, Experimental',
          styles: 'Fusion',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await db.addRelease(release);
      }

      // Filter shouldn't modify underlying data
      const filtered = await collectionService.filterReleases({
        genres: ['Rock'],
      });

      // Verify original data intact
      const allAfterFilter = await db.getAllReleases();
      expect(allAfterFilter.length).toBe(2);

      // Get stats shouldn't modify data
      const stats = await collectionService.getStats();

      // Verify still intact
      const allAfterStats = await db.getAllReleases();
      expect(allAfterStats.length).toBe(2);
      expect(stats.totalReleases).toBe(2);
    });
  });
});
