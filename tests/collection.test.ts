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
      addRelease: jest.fn(),
      getAllReleases: jest.fn(),
      getReleasesByGenre: jest.fn(),
      getReleasesByYear: jest.fn(),
    } as any;

    collectionService = new CollectionService(discogsClientMock, dbMock);
  });

  test('should filter releases by genre', () => {
    const releases = [
      {
        discogsId: 1,
        title: 'Album 1',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock, Indie',
        styles: 'Alternative Rock',
      },
      {
        discogsId: 2,
        title: 'Album 2',
        artists: 'Artist 2',
        year: 2021,
        genres: 'Jazz, Blues',
        styles: 'Bebop',
      },
    ];

    (dbMock.getAllReleases as jest.Mock).mockReturnValue(releases);

    const filtered = collectionService.filterReleases({ genres: ['Rock'] });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Album 1');
  });

  test('should filter releases by year range', () => {
    const releases = [
      {
        discogsId: 1,
        title: 'Album 1',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative Rock',
      },
      {
        discogsId: 2,
        title: 'Album 2',
        artists: 'Artist 2',
        year: 2022,
        genres: 'Jazz',
        styles: 'Bebop',
      },
    ];

    (dbMock.getAllReleases as jest.Mock).mockReturnValue(releases);

    const filtered = collectionService.filterReleases({ minYear: 2021, maxYear: 2023 });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].year).toBe(2022);
  });
});
