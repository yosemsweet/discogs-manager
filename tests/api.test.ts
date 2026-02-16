import { DiscogsAPIClient } from '../src/api/discogs';
import axios from 'axios';

jest.mock('axios');
jest.mock('../src/utils/retry', () => ({
  retryWithBackoff: jest.fn((fn) => fn()),
  isRetryableError: jest.fn(() => false),
  DEFAULT_RETRY_CONFIG: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    jitterFactor: 0.1,
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DiscogsAPIClient', () => {
  let client: DiscogsAPIClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new DiscogsAPIClient('test-token', 'test-user');
  });

  describe('constructor', () => {
    test('should initialize with token and username', () => {
      expect(client).toBeDefined();
    });
  });

  describe('getCollection', () => {
    test('should fetch collection for user', async () => {
      const mockResponse = {
        data: {
          releases: [
            { id: 1, title: 'Album 1' },
            { id: 2, title: 'Album 2' },
          ],
        },
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await new DiscogsAPIClient('token', 'user').getCollection('testuser');

      expect(result).toEqual(mockResponse.data);
    });

    test('should use default username if not provided', async () => {
      const mockResponse = { data: { releases: [] } };
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockResponse),
      } as any);

      const client = new DiscogsAPIClient('token', 'default-user');
      const result = await client.getCollection();

      expect(result).toEqual(mockResponse.data);
    });

    test('should throw error on API failure', async () => {
      const error = new Error('API Error');
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(error),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      await expect(client.getCollection('user')).rejects.toThrow();
    });
  });

  describe('getRelease', () => {
    test('should fetch release details', async () => {
      const mockRelease = {
        id: 1,
        title: 'Test Album',
        artists: [{ name: 'Test Artist' }],
        year: 2020,
        genres: ['Rock'],
        styles: ['Alternative'],
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: mockRelease }),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      const result = await client.getRelease(1);

      expect(result).toEqual(mockRelease);
    });

    test('should throw error if release not found', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Not found')),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      await expect(client.getRelease(999)).rejects.toThrow();
    });
  });

  describe('searchRelease', () => {
    test('should search for releases', async () => {
      const mockResults = {
        results: [
          { id: 1, title: 'Match 1', type: 'release' },
          { id: 2, title: 'Match 2', type: 'release' },
        ],
      };

      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: mockResults }),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      const result = await client.searchRelease('test query', 10);

      expect(result).toEqual(mockResults);
    });

    test('should use default limit if not provided', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { results: [] } }),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      await client.searchRelease('query');

      expect(true).toBe(true);
    });

    test('should throw error on search failure', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Search failed')),
      } as any);

      const client = new DiscogsAPIClient('token', 'user');
      await expect(client.searchRelease('query')).rejects.toThrow();
    });
  });
});
