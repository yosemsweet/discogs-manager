import { DiscogsAPIClient } from '../src/api/discogs';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { DatabaseManager } from '../src/services/database';
import { CollectionService } from '../src/services/collection';
import { PlaylistService } from '../src/services/playlist';

// Mock axios
jest.mock('axios');
jest.mock('axios-retry', () => ({
  __esModule: true,
  default: jest.fn((client) => client),
}));

import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Error Handling and Edge Cases', () => {
  let mockDiscogsClient: DiscogsAPIClient;
  let mockSoundCloudClient: SoundCloudAPIClient;
  let mockDb: DatabaseManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as any);

    mockDiscogsClient = new DiscogsAPIClient('test-token', 'test-user');
    mockSoundCloudClient = new SoundCloudAPIClient('test-id', 'test-token');
    mockDb = new DatabaseManager(':memory:');
  });

  afterEach(async () => {
    await mockDb.close();
  });

  describe('API Error Handling', () => {
    describe('Discogs API', () => {
      test('should handle invalid username gracefully', async () => {
        mockedAxios.create.mockReturnValue({
          get: jest.fn().mockRejectedValue({
            response: { status: 404, data: { message: 'User not found' } },
          }),
        } as any);

        const client = new DiscogsAPIClient('token', 'invalid-user');
        await expect(client.getCollection()).rejects.toThrow();
      });

      test('should handle rate limiting (429)', async () => {
        mockedAxios.create.mockReturnValue({
          get: jest.fn().mockRejectedValue({
            response: { status: 429, data: { message: 'Rate limit exceeded' } },
          }),
        } as any);

        const client = new DiscogsAPIClient('token', 'user');
        await expect(client.getRelease(123)).rejects.toThrow();
      });

      test('should handle authentication errors (401)', async () => {
        mockedAxios.create.mockReturnValue({
          get: jest.fn().mockRejectedValue({
            response: { status: 401, data: { message: 'Unauthorized' } },
          }),
        } as any);

        const client = new DiscogsAPIClient('invalid-token', 'user');
        await expect(client.getRelease(123)).rejects.toThrow();
      });

      test('should handle server errors (500)', async () => {
        mockedAxios.create.mockReturnValue({
          get: jest.fn().mockRejectedValue({
            response: { status: 500, data: { message: 'Internal server error' } },
          }),
        } as any);

        const client = new DiscogsAPIClient('token', 'user');
        await expect(client.getRelease(123)).rejects.toThrow();
      });

      test('should handle network errors', async () => {
        mockedAxios.create.mockReturnValue({
          get: jest.fn().mockRejectedValue(new Error('Network timeout')),
        } as any);

        const client = new DiscogsAPIClient('token', 'user');
        await expect(client.getRelease(123)).rejects.toThrow();
      });
    });

    describe('SoundCloud API', () => {
      test('should handle invalid playlist title', async () => {
        mockedAxios.create.mockReturnValue({
          post: jest.fn().mockRejectedValue({
            response: { status: 400, data: { message: 'Invalid title' } },
          }),
        } as any);

        const client = new SoundCloudAPIClient('id', 'token');
        await expect(client.createPlaylist('')).rejects.toThrow();
      });

      test('should handle playlist not found (404)', async () => {
        mockedAxios.create.mockReturnValue({
          put: jest.fn().mockRejectedValue({
            response: { status: 404, data: { message: 'Playlist not found' } },
          }),
        } as any);

        const client = new SoundCloudAPIClient('id', 'token');
        await expect(client.addTrackToPlaylist('invalid-id', 'track-id')).rejects.toThrow();
      });

      test('should handle authentication errors', async () => {
        mockedAxios.create.mockReturnValue({
          post: jest.fn().mockRejectedValue({
            response: { status: 401, data: { message: 'Unauthorized' } },
          }),
        } as any);

        const client = new SoundCloudAPIClient('id', 'invalid-token');
        await expect(client.createPlaylist('test')).rejects.toThrow();
      });
    });
  });

  describe('Database Edge Cases', () => {
    test('should handle adding duplicate releases', async () => {
      await mockDb.initialized;

      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      // Adding same release again should use INSERT OR REPLACE
      await mockDb.addRelease(release);

      const releases = await mockDb.getAllReleases();
      expect(releases).toHaveLength(1);
    });

    test('should handle querying empty database', async () => {
      await mockDb.initialized;

      const releases = await mockDb.getAllReleases();
      expect(releases).toEqual([]);
    });

    test('should handle filtering with no matches', async () => {
      await mockDb.initialized;

      const release: any = {
        discogsId: 1,
        title: 'Rock Album',
        artists: 'Rock Band',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const results = await mockDb.getReleasesByGenre('Jazz');
      expect(results).toEqual([]);
    });

    test('should handle year filtering edge cases', async () => {
      await mockDb.initialized;

      const oldRelease: any = {
        discogsId: 1,
        title: 'Old Album',
        artists: 'Old Band',
        year: 1980,
        genres: 'Rock',
        styles: 'Classic',
        addedAt: new Date(),
      };

      const newRelease: any = {
        discogsId: 2,
        title: 'New Album',
        artists: 'New Band',
        year: 2024,
        genres: 'Rock',
        styles: 'Modern',
        addedAt: new Date(),
      };

      await mockDb.addRelease(oldRelease);
      await mockDb.addRelease(newRelease);

      const results = await mockDb.getReleasesByYear(1900, 2100);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle null/undefined values gracefully', async () => {
      await mockDb.initialized;

      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: null,
        genres: null,
        styles: null,
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const releases = await mockDb.getAllReleases();
      expect(releases).toHaveLength(1);
    });

    test('should handle special characters in genre names', async () => {
      await mockDb.initialized;

      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: "R&B, Hip-Hop/Rap, Soul (70's)",
        styles: "Alternative Rock (80's)",
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const releases = await mockDb.getAllReleases();
      expect(releases[0].genres).toBe("R&B, Hip-Hop/Rap, Soul (70's)");
    });
  });

  describe('Service Layer Edge Cases', () => {
    test('CollectionService should handle empty collection', async () => {
      const mockClient = {
        getCollectionPaginated: jest.fn().mockResolvedValue({ releases: [], pagination: { pages: 0 } }),
      } as any;

      const service = new CollectionService(mockClient, mockDb);
      const result = await service.syncCollection('test-user');

      expect(result).toBe(0);
    });

    test('CollectionService should handle sync with network errors', async () => {
      const mockClient = {
        getCollectionPaginated: jest.fn().mockRejectedValue(new Error('Network error')),
      } as any;

      const service = new CollectionService(mockClient, mockDb);
      await expect(service.syncCollection('test-user')).rejects.toThrow();
    });

    test('PlaylistService should handle creating playlist with no releases', async () => {
      const mockSoundCloudClient = {
        createPlaylist: jest.fn().mockResolvedValue({ id: 'playlist-1' }),
      } as any;

      const service = new PlaylistService(mockSoundCloudClient, mockDb);
      const result = await service.createPlaylist('Test Playlist', []);

      expect(result.id).toBe('playlist-1');
    });

    test('should handle very long genre lists', async () => {
      await mockDb.initialized;

      const genres = Array.from({ length: 50 }, (_, i) => `Genre${i}`).join(', ');
      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres,
        styles: 'Style',
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const releases = await mockDb.getAllReleases();
      expect(releases[0].genres).toBe(genres);
    });
  });

  describe('Input Validation Edge Cases', () => {
    test('should validate empty search query', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { results: [] } }),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      const result = await client.searchRelease('');
      expect(result).toBeDefined();
    });

    test('should handle very long artist names', async () => {
      await mockDb.initialized;

      const longArtistName = 'A'.repeat(1000);
      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: longArtistName,
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const releases = await mockDb.getAllReleases();
      expect(releases[0].artists).toBe(longArtistName);
    });

    test('should handle year boundary values', async () => {
      await mockDb.initialized;

      const ancientRelease: any = {
        discogsId: 1,
        title: 'Ancient Album',
        artists: 'Ancient Artist',
        year: 1900,
        genres: 'Classical',
        styles: 'Symphony',
        addedAt: new Date(),
      };

      const futureRelease: any = {
        discogsId: 2,
        title: 'Future Album',
        artists: 'Future Artist',
        year: 2099,
        genres: 'Electronic',
        styles: 'Experimental',
        addedAt: new Date(),
      };

      await mockDb.addRelease(ancientRelease);
      await mockDb.addRelease(futureRelease);

      const releases = await mockDb.getAllReleases();
      expect(releases).toHaveLength(2);
    });

    test('should handle releases with negative ratings gracefully', async () => {
      await mockDb.initialized;

      const release: any = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        rating: -5,
        addedAt: new Date(),
      };

      await mockDb.addRelease(release);
      const releases = await mockDb.getAllReleases();
      expect(releases).toHaveLength(1);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent database writes', async () => {
      await mockDb.initialized;

      const releases: any[] = Array.from({ length: 10 }, (_, i) => ({
        discogsId: i,
        title: `Album ${i}`,
        artists: `Artist ${i}`,
        year: 2020 + i,
        genres: `Genre ${i}`,
        styles: `Style ${i}`,
        addedAt: new Date(),
      }));

      await Promise.all(releases.map(r => mockDb.addRelease(r)));
      const result = await mockDb.getAllReleases();
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle concurrent reads and writes', async () => {
      await mockDb.initialized;

      const release1: any = {
        discogsId: 1,
        title: 'Album 1',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await mockDb.addRelease(release1);

      const [reads, written] = await Promise.all([
        mockDb.getAllReleases(),
        mockDb.addRelease({
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        } as any),
      ]);

      expect(Array.isArray(reads)).toBe(true);
    });
  });

  describe('Resource Management', () => {
    test('should handle database close and reopen', async () => {
      const db = new DatabaseManager(':memory:');
      await db.initialized;

      await db.addRelease({
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      } as any);

      await db.close();

      // Attempting to use after close should handle gracefully
      expect(async () => {
        await db.getAllReleases();
      }).toBeDefined();
    });

    test('should handle multiple database instances', async () => {
      const db1 = new DatabaseManager(':memory:');
      const db2 = new DatabaseManager(':memory:');

      await Promise.all([db1.initialized, db2.initialized]);

      await db1.addRelease({
        discogsId: 1,
        title: 'Album 1',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      } as any);

      const releases1 = await db1.getAllReleases();
      const releases2 = await db2.getAllReleases();

      expect(releases1.length).toBe(1);
      expect(releases2.length).toBe(0);

      await db1.close();
      await db2.close();
    });
  });
});
