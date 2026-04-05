import { createSyncCommand } from '../src/commands/sync';
import { createListCommand } from '../src/commands/list';
import { createStatsCommand } from '../src/commands/stats';
import { createPlaylistCommand } from '../src/commands/playlist';
import { createCollectionCommand } from '../src/commands/collection';
import { DiscogsAPIClient } from '../src/api/discogs';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { DatabaseManager } from '../src/services/database';

jest.mock('chalk', () => ({
  __esModule: true,
  default: {
    green: (str: string) => str,
    red: (str: string) => str,
    cyan: (str: string) => str,
    yellow: (str: string) => str,
    gray: (str: string) => str,
    bold: (str: string) => str,
  },
}));

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));

jest.mock('../src/api/discogs');
jest.mock('../src/api/soundcloud');
jest.mock('../src/services/database');

describe('CLI Commands', () => {
  let mockDiscogsClient: DiscogsAPIClient;
  let mockSoundCloudClient: SoundCloudAPIClient;
  let mockDb: DatabaseManager;

  beforeEach(() => {
    mockDiscogsClient = {
      getCollection: jest.fn(),
      getRelease: jest.fn(),
      searchRelease: jest.fn(),
    } as unknown as DiscogsAPIClient;

    mockSoundCloudClient = {
      createPlaylist: jest.fn(),
      addTrackToPlaylist: jest.fn(),
      searchTrack: jest.fn(),
      getPlaylist: jest.fn(),
    } as unknown as SoundCloudAPIClient;

    mockDb = {
      addRelease: jest.fn(),
      getAllReleases: jest.fn(),
      getReleasesByGenre: jest.fn(),
      getReleasesByYear: jest.fn(),
      createPlaylist: jest.fn(),
      addReleaseToPlaylist: jest.fn(),
      getPlaylistReleases: jest.fn(),
      close: jest.fn(),
    } as unknown as DatabaseManager;
  });

  describe('sync command', () => {
    test('should create sync command with correct description', () => {
      const cmd = createSyncCommand(mockDiscogsClient, mockDb);
      expect(cmd.name()).toBe('sync');
      expect(cmd.description()).toContain('Discogs collection');
    });

    test('should have username option', () => {
      const cmd = createSyncCommand(mockDiscogsClient, mockDb);
      expect(cmd.options.some((opt) => opt.long === '--username')).toBe(true);
    });

    test('should have verbose option', () => {
      const cmd = createSyncCommand(mockDiscogsClient, mockDb);
      expect(cmd.options.some((opt) => opt.long === '--verbose')).toBe(true);
    });
  });

  describe('list command', () => {
    test('should create list command with correct description', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      expect(cmd.name()).toBe('list');
      expect(cmd.description()).toContain('List releases');
    });

    test('should have genre, year, and limit options', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      const options = cmd.options;
      expect(options.some((opt) => opt.long === '--genres')).toBe(true);
      expect(options.some((opt) => opt.long === '--min-year' || opt.long === '--max-year')).toBe(true);
      expect(options.some((opt) => opt.long === '--limit')).toBe(true);
    });

    test('should have verbose option', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      expect(cmd.options.some((opt) => opt.long === '--verbose')).toBe(true);
    });

    test('should have acquired-after and acquired-before options (hyphens)', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      expect(cmd.options.some((opt) => opt.long === '--acquired-after')).toBe(true);
      expect(cmd.options.some((opt) => opt.long === '--acquired-before')).toBe(true);
    });
  });

  describe('stats command', () => {
    test('should create stats command with correct description', () => {
      const cmd = createStatsCommand(mockDiscogsClient, mockDb);
      expect(cmd.name()).toBe('stats');
      expect(cmd.description()).toContain('statistics');
    });

    test('should have verbose option', () => {
      const cmd = createStatsCommand(mockDiscogsClient, mockDb);
      const verboseOption = cmd.options.find((opt) => opt.long === '--verbose');
      expect(verboseOption).toBeDefined();
      expect(verboseOption?.short).toBe('-v');
    });
  });

  describe('playlist command', () => {
    test('should create playlist command with correct description', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      expect(cmd.name()).toBe('playlist');
      expect(cmd.description()).toContain('SoundCloud playlists');
    });

    test('playlist create subcommand has title, description, genres, year, and privacy options', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      const options = create.options;
      expect(options.some((opt) => opt.long === '--title')).toBe(true);
      expect(options.some((opt) => opt.long === '--description')).toBe(true);
      expect(options.some((opt) => opt.long === '--genres')).toBe(true);
      expect(options.some((opt) => opt.long === '--min-year')).toBe(true);
      expect(options.some((opt) => opt.long === '--max-year')).toBe(true);
      expect(options.some((opt) => opt.long === '--private')).toBe(true);
    });

    test('playlist create has acquired-after and acquired-before options (hyphens)', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      expect(create.options.some((opt) => opt.long === '--acquired-after')).toBe(true);
      expect(create.options.some((opt) => opt.long === '--acquired-before')).toBe(true);
    });
  });

  describe('collection command group', () => {
    test('collection command wraps sync, list, stats, retry', () => {
      const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
      const names = cmd.commands.map(c => c.name());
      expect(names).toContain('sync');
      expect(names).toContain('list');
      expect(names).toContain('stats');
      expect(names).toContain('retry');
    });
  });

  describe('Command Integration', () => {
    test('sync command accepts username option', () => {
      const cmd = createSyncCommand(mockDiscogsClient, mockDb);
      const usernameOption = cmd.options.find((opt) => opt.long === '--username');
      expect(usernameOption).toBeDefined();
      expect(usernameOption?.short).toBe('-u');
    });

    test('list command applies limit correctly', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      const limitOption = cmd.options.find((opt) => opt.long === '--limit');
      expect(limitOption?.defaultValue).toBe('50');
    });

    test('playlist create command handles genre filtering', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      const genresOption = create.options.find((opt) => opt.long === '--genres');
      expect(genresOption).toBeDefined();
    });

    test('all commands are properly initialized', () => {
      const syncCmd = createSyncCommand(mockDiscogsClient, mockDb);
      const listCmd = createListCommand(mockDiscogsClient, mockDb);
      const statsCmd = createStatsCommand(mockDiscogsClient, mockDb);
      const playlistCmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);

      expect(syncCmd.name()).toBe('sync');
      expect(listCmd.name()).toBe('list');
      expect(statsCmd.name()).toBe('stats');
      expect(playlistCmd.name()).toBe('playlist');
    });

    test('commands have descriptions', () => {
      const syncCmd = createSyncCommand(mockDiscogsClient, mockDb);
      const listCmd = createListCommand(mockDiscogsClient, mockDb);
      const statsCmd = createStatsCommand(mockDiscogsClient, mockDb);
      const playlistCmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);

      expect(syncCmd.description()).toBeTruthy();
      expect(listCmd.description()).toBeTruthy();
      expect(statsCmd.description()).toBeTruthy();
      expect(playlistCmd.description()).toBeTruthy();
    });

    test('sync command requires discogsClient and db', () => {
      expect(() => createSyncCommand(mockDiscogsClient, mockDb)).not.toThrow();
    });

    test('list command requires discogsClient and db', () => {
      expect(() => createListCommand(mockDiscogsClient, mockDb)).not.toThrow();
    });

    test('stats command requires discogsClient and db', () => {
      expect(() => createStatsCommand(mockDiscogsClient, mockDb)).not.toThrow();
    });

    test('playlist command requires all three clients', () => {
      expect(() =>
        createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb)
      ).not.toThrow();
    });
  });

  describe('Command Options', () => {
    test('sync command supports short and long username options', () => {
      const cmd = createSyncCommand(mockDiscogsClient, mockDb);
      const usernameOption = cmd.options.find((opt) => opt.long === '--username');
      expect(usernameOption?.short).toBe('-u');
    });

    test('list command supports short and long genre option', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      const genreOption = cmd.options.find((opt) => opt.long === '--genres');
      expect(genreOption?.short).toBe('-g');
    });

    test('list command supports --min-year option', () => {
      const cmd = createListCommand(mockDiscogsClient, mockDb);
      const minYearOption = cmd.options.find((opt) => opt.long === '--min-year');
      expect(minYearOption).toBeDefined();
    });

    test('playlist create supports short and long title option', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      const titleOption = create.options.find((opt) => opt.long === '--title');
      expect(titleOption?.short).toBe('-t');
    });

    test('playlist create supports short and long description option', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      const descOption = create.options.find((opt) => opt.long === '--description');
      expect(descOption?.short).toBe('-d');
    });

    test('playlist create supports short and long genres option', () => {
      const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
      const create = cmd.commands.find(c => c.name() === 'create')!;
      const genresOption = create.options.find((opt) => opt.long === '--genres');
      expect(genresOption?.short).toBe('-g');
    });
  });
});
