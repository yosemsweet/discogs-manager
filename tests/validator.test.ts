import { Validator, ValidationError } from '../src/utils/validator';
import { PlaylistFilter } from '../src/types';

describe('Validator', () => {
  describe('validateSyncOptions', () => {
    test('should validate valid sync options with username', () => {
      const options = { username: 'testuser', force: false };
      const result = Validator.validateSyncOptions(options);
      expect(result.username).toBe('testuser');
      expect(result.force).toBe(false);
      expect(result.releaseIds).toBeUndefined();
    });

    test('should use DISCOGS_USERNAME env variable', () => {
      const originalEnv = process.env.DISCOGS_USERNAME;
      process.env.DISCOGS_USERNAME = 'envuser';
      
      const options = { force: false };
      const result = Validator.validateSyncOptions(options);
      expect(result.username).toBe('envuser');
      
      process.env.DISCOGS_USERNAME = originalEnv;
    });

    test('should throw on missing username', () => {
      const originalEnv = process.env.DISCOGS_USERNAME;
      delete process.env.DISCOGS_USERNAME;
      
      const options = { force: false };
      expect(() => Validator.validateSyncOptions(options)).toThrow(ValidationError);
      
      process.env.DISCOGS_USERNAME = originalEnv;
    });

    test('should throw on empty username', () => {
      const options = { username: '', force: false };
      expect(() => Validator.validateSyncOptions(options)).toThrow(ValidationError);
    });

    test('should throw on username longer than 50 chars', () => {
      const options = { username: 'a'.repeat(51), force: false };
      expect(() => Validator.validateSyncOptions(options)).toThrow(ValidationError);
    });

    test('should validate release IDs', () => {
      const options = { username: 'testuser', force: true, releaseIds: '1,2,3' };
      const result = Validator.validateSyncOptions(options);
      expect(result.releaseIds).toEqual([1, 2, 3]);
      expect(result.force).toBe(true);
    });

    test('should throw on invalid release IDs', () => {
      const options = { username: 'testuser', force: false, releaseIds: '1,abc,3' };
      expect(() => Validator.validateSyncOptions(options)).toThrow(ValidationError);
    });
  });

  describe('validateListOptions', () => {
    test('should validate valid list options', () => {
      const options = {
        username: 'testuser',
        limit: '100',
        genres: 'Rock,Jazz',
        minYear: '2000',
        maxYear: '2020',
      };
      const result = Validator.validateListOptions(options);
      
      expect(result.username).toBe('testuser');
      expect(result.limit).toBe(100);
      expect(result.filter.genres).toEqual(['Rock', 'Jazz']);
      expect(result.filter.minYear).toBe(2000);
      expect(result.filter.maxYear).toBe(2020);
    });

    test('should validate with default limit', () => {
      const options = { username: 'testuser' };
      const result = Validator.validateListOptions(options);
      expect(result.limit).toBe(50);
    });

    test('should throw on invalid limit', () => {
      const options = { username: 'testuser', limit: '0' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should throw on limit exceeding max', () => {
      const options = { username: 'testuser', limit: '10001' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should trim and filter genres', () => {
      const options = { username: 'testuser', genres: '  Rock  ,  , Jazz  ' };
      const result = Validator.validateListOptions(options);
      expect(result.filter.genres).toEqual(['Rock', 'Jazz']);
    });

    test('should throw on empty genres list', () => {
      const options = { username: 'testuser', genres: '  ,  ,  ' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should throw on genre name too long', () => {
      const options = { username: 'testuser', genres: 'a'.repeat(101) };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should validate year ranges', () => {
      const options = {
        username: 'testuser',
        minYear: '1990',
        maxYear: '2010',
      };
      const result = Validator.validateListOptions(options);
      expect(result.filter.minYear).toBe(1990);
      expect(result.filter.maxYear).toBe(2010);
    });

    test('should throw on invalid year', () => {
      const options = { username: 'testuser', minYear: 'abc' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should throw on year out of range', () => {
      const options = { username: 'testuser', maxYear: '2200' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should throw when minYear > maxYear', () => {
      const options = {
        username: 'testuser',
        minYear: '2020',
        maxYear: '2000',
      };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should validate ratings', () => {
      const options = {
        username: 'testuser',
        minRating: '2.5',
        maxRating: '4.5',
      };
      const result = Validator.validateListOptions(options);
      expect(result.filter.minRating).toBe(2.5);
      expect(result.filter.maxRating).toBe(4.5);
    });

    test('should throw on invalid rating', () => {
      const options = { username: 'testuser', minRating: '6' };
      expect(() => Validator.validateListOptions(options)).toThrow(ValidationError);
    });

    test('should validate styles', () => {
      const options = { username: 'testuser', styles: 'Bebop, Fusion' };
      const result = Validator.validateListOptions(options);
      expect(result.filter.styles).toEqual(['Bebop', 'Fusion']);
    });
  });

  describe('validatePlaylistOptions', () => {
    test('should validate valid playlist options', () => {
      const options = {
        title: 'My Playlist',
        description: 'A great playlist',
        genres: 'Rock',
        minYear: '2000',
        private: true,
      };
      const result = Validator.validatePlaylistOptions(options);
      
      expect(result.title).toBe('My Playlist');
      expect(result.description).toBe('A great playlist');
      expect(result.isPrivate).toBe(true);
      expect(result.filter.genres).toEqual(['Rock']);
    });

    test('should throw on missing title', () => {
      const options = { description: 'A playlist' };
      expect(() => Validator.validatePlaylistOptions(options)).toThrow(ValidationError);
    });

    test('should throw on empty title', () => {
      const options = { title: '   ' };
      expect(() => Validator.validatePlaylistOptions(options)).toThrow(ValidationError);
    });

    test('should throw on title too long', () => {
      const options = { title: 'a'.repeat(201) };
      expect(() => Validator.validatePlaylistOptions(options)).toThrow(ValidationError);
    });

    test('should throw on description too long', () => {
      const options = { title: 'My Playlist', description: 'a'.repeat(1001) };
      expect(() => Validator.validatePlaylistOptions(options)).toThrow(ValidationError);
    });

    test('should validate release IDs for playlist', () => {
      const options = { title: 'My Playlist', releaseIds: '123,456' };
      const result = Validator.validatePlaylistOptions(options);
      expect(result.releaseIds).toEqual([123, 456]);
    });

    test('should validate year ranges for playlist', () => {
      const options = {
        title: 'My Playlist',
        minYear: '1980',
        maxYear: '2000',
      };
      const result = Validator.validatePlaylistOptions(options);
      expect(result.filter.minYear).toBe(1980);
      expect(result.filter.maxYear).toBe(2000);
    });
  });

  describe('validateStatsOptions', () => {
    test('should validate valid stats options', () => {
      const options = { username: 'testuser' };
      const result = Validator.validateStatsOptions(options);
      expect(result.username).toBe('testuser');
    });

    test('should use DISCOGS_USERNAME env variable', () => {
      const originalEnv = process.env.DISCOGS_USERNAME;
      process.env.DISCOGS_USERNAME = 'envuser';
      
      const options = {};
      const result = Validator.validateStatsOptions(options);
      expect(result.username).toBe('envuser');
      
      process.env.DISCOGS_USERNAME = originalEnv;
    });

    test('should throw on missing username', () => {
      const originalEnv = process.env.DISCOGS_USERNAME;
      delete process.env.DISCOGS_USERNAME;
      
      expect(() => Validator.validateStatsOptions({})).toThrow(ValidationError);
      
      process.env.DISCOGS_USERNAME = originalEnv;
    });
  });

  describe('validateDiscogsRelease', () => {
    test('should validate correct release object', () => {
      const release = {
        id: 123,
        title: 'Album Title',
        artists: ['Artist 1'],
        year: 2020,
        genres: ['Rock'],
        styles: ['Hard Rock'],
        uri: '/releases/123',
        resource_url: 'https://api.discogs.com/releases/123',
      };
      
      expect(Validator.validateDiscogsRelease(release)).toBe(true);
    });

    test('should throw on missing id', () => {
      const release = {
        title: 'Album Title',
        artists: [],
        year: 2020,
        genres: [],
        styles: [],
        uri: '',
        resource_url: '',
      };
      
      expect(() => Validator.validateDiscogsRelease(release)).toThrow(ValidationError);
    });

    test('should throw on invalid id', () => {
      const release = {
        id: -1,
        title: 'Album',
        artists: [],
        year: 2020,
        genres: [],
        styles: [],
        uri: '',
        resource_url: '',
      };
      
      expect(() => Validator.validateDiscogsRelease(release)).toThrow(ValidationError);
    });

    test('should throw on missing title', () => {
      const release = {
        id: 123,
        title: '',
        artists: [],
        year: 2020,
        genres: [],
        styles: [],
        uri: '',
        resource_url: '',
      };
      
      expect(() => Validator.validateDiscogsRelease(release)).toThrow(ValidationError);
    });

    test('should throw on non-array artists', () => {
      const release = {
        id: 123,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: [],
        styles: [],
        uri: '',
        resource_url: '',
      };
      
      expect(() => Validator.validateDiscogsRelease(release)).toThrow(ValidationError);
    });

    test('should throw on invalid year', () => {
      const release = {
        id: 123,
        title: 'Album',
        artists: [],
        year: 3000,
        genres: [],
        styles: [],
        uri: '',
        resource_url: '',
      };
      
      expect(() => Validator.validateDiscogsRelease(release)).toThrow(ValidationError);
    });
  });

  describe('validateStoredRelease', () => {
    test('should validate correct stored release', () => {
      const release = {
        discogsId: 123,
        title: 'Album',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock',
        styles: 'Hard Rock',
        addedAt: new Date(),
      };
      
      expect(Validator.validateStoredRelease(release)).toBe(true);
    });

    test('should throw on invalid discogsId', () => {
      const release = {
        discogsId: -1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Hard Rock',
        addedAt: new Date(),
      };
      
      expect(() => Validator.validateStoredRelease(release)).toThrow(ValidationError);
    });

    test('should throw on non-Date addedAt', () => {
      const release = {
        discogsId: 123,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Hard Rock',
        addedAt: '2020-01-01',
      };
      
      expect(() => Validator.validateStoredRelease(release)).toThrow(ValidationError);
    });
  });

  describe('validateSoundCloudPlaylist', () => {
    test('should validate correct playlist object', () => {
      const playlist = {
        id: 'playlist-123',
        title: 'My Playlist',
        description: 'A great playlist',
        trackCount: 50,
        uri: 'https://soundcloud.com/user/sets/my-playlist',
      };
      
      expect(Validator.validateSoundCloudPlaylist(playlist)).toBe(true);
    });

    test('should throw on missing id', () => {
      const playlist = {
        title: 'My Playlist',
        description: '',
        trackCount: 0,
        uri: '',
      };
      
      expect(() => Validator.validateSoundCloudPlaylist(playlist)).toThrow(ValidationError);
    });

    test('should throw on empty title', () => {
      const playlist = {
        id: '123',
        title: '',
        description: '',
        trackCount: 0,
        uri: '',
      };
      
      expect(() => Validator.validateSoundCloudPlaylist(playlist)).toThrow(ValidationError);
    });

    test('should throw on negative trackCount', () => {
      const playlist = {
        id: '123',
        title: 'Playlist',
        description: '',
        trackCount: -1,
        uri: '',
      };
      
      expect(() => Validator.validateSoundCloudPlaylist(playlist)).toThrow(ValidationError);
    });
  });

  describe('validatePlaylistFilter', () => {
    test('should validate empty filter', () => {
      const filter: PlaylistFilter = {};
      expect(() => Validator.validatePlaylistFilter(filter)).not.toThrow();
    });

    test('should throw on non-array genres', () => {
      const filter: any = { genres: 'Rock' };
      expect(() => Validator.validatePlaylistFilter(filter)).toThrow(ValidationError);
    });

    test('should throw on invalid year range', () => {
      const filter: PlaylistFilter = {
        minYear: 1800,
        maxYear: 2200,
      };
      expect(() => Validator.validatePlaylistFilter(filter)).toThrow(ValidationError);
    });

    test('should throw when minYear > maxYear', () => {
      const filter: PlaylistFilter = {
        minYear: 2020,
        maxYear: 2000,
      };
      expect(() => Validator.validatePlaylistFilter(filter)).toThrow(ValidationError);
    });

    test('should throw on invalid rating range', () => {
      const filter: PlaylistFilter = {
        minRating: 6,
      };
      expect(() => Validator.validatePlaylistFilter(filter)).toThrow(ValidationError);
    });

    test('should validate filter with all fields', () => {
      const filter: PlaylistFilter = {
        genres: ['Rock', 'Jazz'],
        minYear: 1990,
        maxYear: 2020,
        minRating: 3,
        maxRating: 5,
        styles: ['Hard Rock'],
      };
      expect(() => Validator.validatePlaylistFilter(filter)).not.toThrow();
    });
  });

  describe('validateTrackIds', () => {
    test('should validate array of track IDs', () => {
      const trackIds = ['track1', 'track2', 'track3'];
      expect(Validator.validateTrackIds(trackIds)).toBe(true);
    });

    test('should throw on non-array input', () => {
      expect(() => Validator.validateTrackIds('track1' as any)).toThrow(ValidationError);
    });

    test('should throw on empty array', () => {
      expect(() => Validator.validateTrackIds([])).toThrow(ValidationError);
    });

    test('should throw on empty track ID', () => {
      const trackIds = ['track1', '', 'track3'];
      expect(() => Validator.validateTrackIds(trackIds)).toThrow(ValidationError);
    });

    test('should throw on too many tracks', () => {
      const trackIds = Array.from({ length: 10001 }, (_, i) => `track${i}`);
      expect(() => Validator.validateTrackIds(trackIds)).toThrow(ValidationError);
    });

    test('should accept large but valid track ID array', () => {
      const trackIds = Array.from({ length: 1000 }, (_, i) => `track${i}`);
      expect(Validator.validateTrackIds(trackIds)).toBe(true);
    });
  });

  describe('validateString', () => {
    test('should validate valid string', () => {
      const result = Validator.validateString('hello', 'name');
      expect(result).toBe('hello');
    });

    test('should trim whitespace', () => {
      const result = Validator.validateString('  hello  ', 'name');
      expect(result).toBe('hello');
    });

    test('should throw on non-string', () => {
      expect(() => Validator.validateString(123, 'value')).toThrow(ValidationError);
    });

    test('should throw on string too short', () => {
      expect(() => Validator.validateString('', 'value', 1, 10)).toThrow(ValidationError);
    });

    test('should throw on string too long', () => {
      expect(() => Validator.validateString('a'.repeat(11), 'value', 1, 10)).toThrow(ValidationError);
    });

    test('should use custom min/max lengths', () => {
      const result = Validator.validateString('hello', 'name', 3, 10);
      expect(result).toBe('hello');
    });
  });

  describe('validateNumber', () => {
    test('should validate valid number', () => {
      const result = Validator.validateNumber(42, 'count');
      expect(result).toBe(42);
    });

    test('should parse string numbers', () => {
      const result = Validator.validateNumber('42', 'count');
      expect(result).toBe(42);
    });

    test('should throw on NaN', () => {
      expect(() => Validator.validateNumber(NaN, 'value')).toThrow(ValidationError);
    });

    test('should throw on number below min', () => {
      expect(() => Validator.validateNumber(5, 'value', 10, 100)).toThrow(ValidationError);
    });

    test('should throw on number above max', () => {
      expect(() => Validator.validateNumber(150, 'value', 10, 100)).toThrow(ValidationError);
    });

    test('should use custom min/max range', () => {
      const result = Validator.validateNumber(50, 'value', 10, 100);
      expect(result).toBe(50);
    });
  });

  describe('ValidationError', () => {
    test('should create validation error with field and reason', () => {
      const error = new ValidationError('username', 'Username is required');
      expect(error.field).toBe('username');
      expect(error.reason).toBe('Username is required');
      expect(error.message).toContain('username');
      expect(error.message).toContain('Username is required');
    });

    test('should be instance of Error', () => {
      const error = new ValidationError('field', 'reason');
      expect(error instanceof Error).toBe(true);
    });
  });
});
