import { createSyncCommand } from '../src/commands/sync';
import { createListCommand } from '../src/commands/list';
import { createStatsCommand } from '../src/commands/stats';
import { createRetryCommand } from '../src/commands/retry';
import { createPlaylistCommand } from '../src/commands/playlist';
import { program as rootProgram } from 'commander';
import { DiscogsAPIClient } from '../src/api/discogs';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { DatabaseManager } from '../src/services/database';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('chalk', () => ({
  __esModule: true,
  default: { green: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s, yellow: (s: string) => s, gray: (s: string) => s, bold: (s: string) => s },
}));
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: jest.fn().mockReturnThis(), succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(), warn: jest.fn().mockReturnThis(), text: '' }),
}));

const mockDiscogsClient = {} as DiscogsAPIClient;
const mockSoundCloudClient = {} as SoundCloudAPIClient;
const mockDb = { initialized: Promise.resolve() } as unknown as DatabaseManager;

// ---------------------------------------------------------------------------
// Change 4: --acquired-after / --acquired-before use hyphens everywhere
// ---------------------------------------------------------------------------

describe('--acquired-after / --acquired-before use hyphens', () => {
  test('collection list registers --acquired-after (hyphen)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired-after')).toBe(true);
  });

  test('collection list does NOT register --acquired_after (underscore)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired_after')).toBe(false);
  });

  test('collection list registers --acquired-before (hyphen)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired-before')).toBe(true);
  });

  test('collection list does NOT register --acquired_before (underscore)', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.options.some(o => o.long === '--acquired_before')).toBe(false);
  });

  test('playlist create registers --acquired-after (hyphen)', () => {
    const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
    const create = cmd.commands.find(c => c.name() === 'create')!;
    expect(create.options.some(o => o.long === '--acquired-after')).toBe(true);
  });

  test('playlist create does NOT register --acquired_after (underscore)', () => {
    const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
    const create = cmd.commands.find(c => c.name() === 'create')!;
    expect(create.options.some(o => o.long === '--acquired_after')).toBe(false);
  });

  test('playlist update registers --acquired-after and --acquired-before (hyphens)', () => {
    const cmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
    const update = cmd.commands.find(c => c.name() === 'update')!;
    expect(update.options.some(o => o.long === '--acquired-after')).toBe(true);
    expect(update.options.some(o => o.long === '--acquired-before')).toBe(true);
  });

  test('Commander maps --acquired-after to camelCase attributeName acquiredAfter', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--acquired-after')!;
    // Commander derives the property name from the flag; hyphen → camelCase
    expect(opt.attributeName()).toBe('acquiredAfter');
  });

  test('Commander maps --acquired-after on playlist create to attributeName acquiredAfter', () => {
    const playlistCmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
    const create = playlistCmd.commands.find(c => c.name() === 'create')!;
    const opt = create.options.find(o => o.long === '--acquired-after')!;
    expect(opt.attributeName()).toBe('acquiredAfter');
  });
});

// ---------------------------------------------------------------------------
// Change 5: --username / -u on all collection commands; no positionals
// ---------------------------------------------------------------------------

describe('--username / -u flag standardization', () => {
  test('collection sync has --username / -u', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('collection list has --username / -u', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('collection list has no positional username argument', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    expect(cmd.registeredArguments.length).toBe(0);
  });

  test('collection stats has --username / -u', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('collection stats has no positional username argument', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    expect(cmd.registeredArguments.length).toBe(0);
  });

  test('collection retry has --username / -u', () => {
    const cmd = createRetryCommand(mockDb);
    const opt = cmd.options.find(o => o.long === '--username');
    expect(opt?.short).toBe('-u');
  });

  test('collection retry has no required positional argument', () => {
    const cmd = createRetryCommand(mockDb);
    expect(cmd.registeredArguments.filter(a => a.required).length).toBe(0);
  });

  test('--username option attributeName is "username"', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--username')!;
    expect(opt.attributeName()).toBe('username');
  });
});

// ---------------------------------------------------------------------------
// Change 6: DISCOGS_API_TOKEN in retry (not DISCOGS_TOKEN)
// ---------------------------------------------------------------------------

describe('collection retry reads DISCOGS_API_TOKEN', () => {
  test('retry.ts source does not reference DISCOGS_TOKEN', () => {
    const retrySource = fs.readFileSync(
      path.join(__dirname, '../src/commands/retry.ts'),
      'utf8'
    );
    expect(retrySource).not.toContain('DISCOGS_TOKEN');
    expect(retrySource).toContain('DISCOGS_API_TOKEN');
  });

  test('collection retry exits 1 with clear error when DISCOGS_API_TOKEN is unset', async () => {
    const savedToken = process.env.DISCOGS_API_TOKEN;
    delete process.env.DISCOGS_API_TOKEN;

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createRetryCommand(mockDb);
    try { await cmd.parseAsync([], { from: 'user' }); } catch { }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DISCOGS_API_TOKEN'));

    if (savedToken !== undefined) process.env.DISCOGS_API_TOKEN = savedToken;
    errorSpy.mockRestore(); exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Change 8: --verbose / -v on sync and list
// ---------------------------------------------------------------------------

describe('--verbose / -v available on all commands', () => {
  test('collection sync registers --verbose / -v', () => {
    const cmd = createSyncCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-v');
  });

  test('collection list registers --verbose / -v', () => {
    const cmd = createListCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt?.short).toBe('-v');
  });

  test('collection stats still has --verbose / -v (regression)', () => {
    const cmd = createStatsCommand(mockDiscogsClient, mockDb);
    const opt = cmd.options.find(o => o.long === '--verbose');
    expect(opt?.short).toBe('-v');
  });

  test('playlist create still has --verbose / -v (regression)', () => {
    const playlistCmd = createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
    const create = playlistCmd.commands.find(c => c.name() === 'create')!;
    const opt = create.options.find(o => o.long === '--verbose');
    expect(opt?.short).toBe('-v');
  });
});

// ---------------------------------------------------------------------------
// Change 9: version 2.1.0
// ---------------------------------------------------------------------------

describe('version 2.1.0', () => {
  test('package.json version is 2.1.0', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    );
    expect(pkg.version).toBe('2.1.0');
  });
});
