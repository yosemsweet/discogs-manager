import { CollectionService } from '../src/services/collection';
import { DiscogsAPIClient } from '../src/api/discogs';
import { DatabaseManager } from '../src/services/database';

describe('CollectionService', () => {
  let collectionService: CollectionService;
  let discogsClientMock: jest.Mocked<DiscogsAPIClient>;
  let dbMock: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    discogsClientMock = {
      getCollection: jest.fn(),
      getRelease: jest.fn(),
      searchRelease: jest.fn(),
    } as any;

    dbMock = {
      addRelease: jest.fn().mockResolvedValue(undefined),
      getAllReleases: jest.fn().mockResolvedValue([]),
      getReleasesByGenre: jest.fn().mockResolvedValue([]),
      getReleasesByYear: jest.fn().mockResolvedValue([]),
      createPlaylist: jest.fn().mockResolvedValue(undefined),
      addReleaseToPlaylist: jest.fn().mockResolvedValue(undefined),
      getPlaylistReleases: jest.fn().mockResolvedValue([]),
      close: jest.fn().mockResolvedValue(undefined),
    } as any;

    collectionService = new CollectionService(discogsClientMock, dbMock);
  });

  describe('filterReleases', () => {
    test('should filter releases by genre', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Indie',
          styles: 'Alternative Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Jazz, Blues',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const filtered = await collectionService.filterReleases({ genres: ['Rock'] });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Album 1');
    });

    test('should filter releases by year range', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2022,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const filtered = await collectionService.filterReleases({ minYear: 2021, maxYear: 2023 });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].year).toBe(2022);
    });

    test('should combine multiple filters', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Rock Album',
          artists: 'Rock Band',
          year: 2020,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Jazz Album',
          artists: 'Jazz Trio',
          year: 2020,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Rock 2020',
          artists: 'Another Band',
          year: 2020,
          genres: 'Rock, Pop',
          styles: 'Alternative',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const filtered = await collectionService.filterReleases({
        genres: ['Rock'],
        minYear: 2020,
        maxYear: 2020,
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.genres.includes('Rock'))).toBe(true);
      expect(filtered.every((r) => r.year === 2020)).toBe(true);
    });

    test('should return empty array when no releases match', async () => {
      (dbMock.getAllReleases as jest.Mock).mockResolvedValue([]);

      const filtered = await collectionService.filterReleases({ genres: ['Nonexistent'] });

      expect(filtered).toHaveLength(0);
    });
  });

  describe('getGenres', () => {
    test('should extract and sort unique genres', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Indie',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2021,
          genres: 'Jazz, Blues',
          styles: 'Bebop',
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

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const genres = await collectionService.getGenres();

      expect(genres).toContain('Rock');
      expect(genres).toContain('Indie');
      expect(genres).toContain('Jazz');
      expect(genres).toContain('Blues');
      expect(genres).toContain('Pop');
      expect(new Set(genres).size).toBe(genres.length); // No duplicates
      expect(genres).toEqual([...genres].sort()); // Sorted
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', async () => {
      const releases = [
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
          year: 2022,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const stats = await collectionService.getStats();

      expect(stats.totalReleases).toBe(2);
      expect(stats.yearsSpan.min).toBe(2020);
      expect(stats.yearsSpan.max).toBe(2022);
    });

    test('getGenreStats returns correct genre counts', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Pop',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2022,
          genres: 'Rock, Electronic',
          styles: 'Bebop',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Album 3',
          artists: 'Artist 3',
          year: 2021,
          genres: 'Pop, Jazz',
          styles: 'Swing',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const genreStats = await collectionService.getGenreStats();

      expect(genreStats.size).toBe(4);
      expect(genreStats.get('Rock')).toBe(2);
      expect(genreStats.get('Pop')).toBe(2);
      expect(genreStats.get('Electronic')).toBe(1);
      expect(genreStats.get('Jazz')).toBe(1);
    });

    test('getStyleStats returns correct style counts', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Pop',
          styles: 'Alternative, Hard Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2',
          artists: 'Artist 2',
          year: 2022,
          genres: 'Rock, Electronic',
          styles: 'Hard Rock',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Album 3',
          artists: 'Artist 3',
          year: 2021,
          genres: 'Electronic',
          styles: 'Ambient',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const styleStats = await collectionService.getStyleStats();

      expect(styleStats.size).toBe(3);
      expect(styleStats.get('Hard Rock')).toBe(2);
      expect(styleStats.get('Alternative')).toBe(1);
      expect(styleStats.get('Ambient')).toBe(1);
    });

    test('getStats returns genreStats and excludes styleStats by default', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Pop',
          styles: 'Alternative',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const stats = await collectionService.getStats();

      expect(stats.genreStats).toBeDefined();
      expect(stats.genreStats.get('Rock')).toBe(1);
      expect(stats.styleStats).toBeUndefined();
    });

    test('getStats returns styleStats when verbose is true', async () => {
      const releases = [
        {
          discogsId: 1,
          title: 'Album 1',
          artists: 'Artist 1',
          year: 2020,
          genres: 'Rock, Pop',
          styles: 'Alternative',
          addedAt: new Date(),
        },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const stats = await collectionService.getStats(true);

      expect(stats.genreStats).toBeDefined();
      expect(stats.styleStats).toBeDefined();
      expect(stats.styleStats?.get('Alternative')).toBe(1);
    });

    test('genre stats are sorted by count descending', async () => {
      const releases = [
        { discogsId: 1, title: 'A1', artists: 'A', year: 2020, genres: 'Rock', styles: '', addedAt: new Date() },
        { discogsId: 2, title: 'A2', artists: 'A', year: 2020, genres: 'Rock', styles: '', addedAt: new Date() },
        { discogsId: 3, title: 'A3', artists: 'A', year: 2020, genres: 'Rock', styles: '', addedAt: new Date() },
        { discogsId: 4, title: 'A4', artists: 'A', year: 2020, genres: 'Pop', styles: '', addedAt: new Date() },
        { discogsId: 5, title: 'A5', artists: 'A', year: 2020, genres: 'Pop', styles: '', addedAt: new Date() },
        { discogsId: 6, title: 'A6', artists: 'A', year: 2020, genres: 'Jazz', styles: '', addedAt: new Date() },
      ];

      (dbMock.getAllReleases as jest.Mock).mockResolvedValue(releases);

      const genreStats = await collectionService.getGenreStats();
      const entries = Array.from(genreStats.entries());

      // Check order: Rock (3), Pop (2), Jazz (1)
      expect(entries[0][0]).toBe('Rock');
      expect(entries[0][1]).toBe(3);
      expect(entries[1][0]).toBe('Pop');
      expect(entries[1][1]).toBe(2);
      expect(entries[2][0]).toBe('Jazz');
      expect(entries[2][1]).toBe(1);
    });
  });
});
