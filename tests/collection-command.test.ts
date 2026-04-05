import { createCollectionCommand } from '../src/commands/collection';
import { createSyncCommand } from '../src/commands/sync';
import { createListCommand } from '../src/commands/list';
import { createStatsCommand } from '../src/commands/stats';
import { createRetryCommand } from '../src/commands/retry';
import { DiscogsAPIClient } from '../src/api/discogs';
import { DatabaseManager } from '../src/services/database';

jest.mock('chalk', () => ({
  __esModule: true,
  default: {
    green: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s,
    yellow: (s: string) => s, gray: (s: string) => s, bold: (s: string) => s,
  },
}));
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: jest.fn().mockReturnThis(), succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(), warn: jest.fn().mockReturnThis(), text: '' }),
}));

const mockDiscogsClient = {} as DiscogsAPIClient;
const mockDb = { initialized: Promise.resolve(), getDLQRecords: jest.fn() } as unknown as DatabaseManager;

describe('createCollectionCommand', () => {
  test('collection command is registered with name "collection"', () => {
    const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
    expect(cmd.name()).toBe('collection');
  });

  test('collection has sync subcommand', () => {
    const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
    const names = cmd.commands.map(c => c.name());
    expect(names).toContain('sync');
  });

  test('collection has list subcommand', () => {
    const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
    expect(cmd.commands.map(c => c.name())).toContain('list');
  });

  test('collection has stats subcommand', () => {
    const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
    expect(cmd.commands.map(c => c.name())).toContain('stats');
  });

  test('collection has retry subcommand', () => {
    const cmd = createCollectionCommand(mockDiscogsClient, mockDb);
    expect(cmd.commands.map(c => c.name())).toContain('retry');
  });
});

describe('collection sync subcommand', () => {
  test('has --force flag', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--force')).toBe(true);
  });

  test('has --username / -u flag', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-u');
  });

  test('has --verbose / -v flag', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-v');
  });
});

describe('collection list subcommand', () => {
  test('has -g/--genres flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--genres');
    expect(opt?.short).toBe('-g');
  });

  test('has -s/--styles flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--styles')).toBe(true);
  });

  test('has -a/--artists flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--artists')).toBe(true);
  });

  test('has -l/--labels flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--labels')).toBe(true);
  });

  test('has --min-year and --max-year flags', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--min-year')).toBe(true);
    expect(cmd.options.some(o => o.long === '--max-year')).toBe(true);
  });

  test('has --min-rating and --max-rating flags', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--min-rating')).toBe(true);
    expect(cmd.options.some(o => o.long === '--max-rating')).toBe(true);
  });

  test('has --acquired-after flag (hyphen)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired-after')).toBe(true);
  });

  test('has --acquired-before flag (hyphen)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired-before')).toBe(true);
  });

  test('has --limit flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--limit')).toBe(true);
  });

  test('has --verbose / -v flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-v');
  });

  test('has --username / -u flag', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('does not have a positional username argument', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.registeredArguments.length).toBe(0);
  });
});

describe('collection stats subcommand', () => {
  test('has --verbose / -v flag', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-v');
  });

  test('has --username / -u flag', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('does not have a positional username argument', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    expect(cmd.registeredArguments.length).toBe(0);
  });
});

describe('collection retry subcommand', () => {
  test('has --username / -u flag', () => {
    const cmd = createRetryCommand(mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('does not have a required positional argument', () => {
    const cmd = createRetryCommand(mockDb);
    const required = cmd.registeredArguments.filter(a => a.required);
    expect(required.length).toBe(0);
  });
});

describe('top-level bare commands are removed', () => {
  // These verify that the individual factories no longer produce top-level names
  // that the old index.ts registered directly. The collection group wraps them.
  test('sync factory still returns a command named sync', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    expect(cmd.name()).toBe('sync');
  });

  test('list factory still returns a command named list', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.name()).toBe('list');
  });

  test('stats factory still returns a command named stats', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    expect(cmd.name()).toBe('stats');
  });

  test('retry factory still returns a command named retry', () => {
    const cmd = createRetryCommand(mockDb);
    expect(cmd.name()).toBe('retry');
  });
});
