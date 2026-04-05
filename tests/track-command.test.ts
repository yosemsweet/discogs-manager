import { createTrackCommand } from '../src/commands/track';
import { createLookupCommand } from '../src/commands/lookup';
import { DatabaseManager } from '../src/services/database';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { StoredRelease } from '../src/types';

jest.mock('chalk', () => ({
  __esModule: true,
  default: { green: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s, yellow: (s: string) => s, gray: (s: string) => s, bold: (s: string) => s },
}));
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: jest.fn().mockReturnThis(), succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(), text: '' }),
}));

function makeMockClient(overrides: Partial<SoundCloudAPIClient> = {}): SoundCloudAPIClient {
  return { resolveUrl: jest.fn(), ...overrides } as unknown as SoundCloudAPIClient;
}

async function setupDb(): Promise<DatabaseManager> {
  const db = new DatabaseManager(':memory:');
  await (db as any).initialized;
  return db;
}

const release: StoredRelease = {
  discogsId: 7001,
  title: 'Bitches Brew',
  artists: 'Miles Davis',
  year: 1970,
  genres: 'Jazz',
  styles: 'Fusion',
  condition: 'VG+',
  rating: 5,
  addedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Structure tests
// ---------------------------------------------------------------------------

describe('createTrackCommand structure', () => {
  let db: DatabaseManager;

  beforeEach(async () => { db = await setupDb(); });
  afterEach(async () => { await db.close(); });

  test('track command is registered with name "track"', () => {
    const cmd = createTrackCommand(null, db);
    expect(cmd.name()).toBe('track');
  });

  test('track has lookup subcommand', () => {
    const cmd = createTrackCommand(null, db);
    expect(cmd.commands.map(c => c.name())).toContain('lookup');
  });

  test('track lookup accepts a URL positional argument', () => {
    const cmd = createLookupCommand(null, db);
    expect(cmd.registeredArguments.length).toBeGreaterThan(0);
    expect(cmd.registeredArguments[0].required).toBe(true);
  });

  test('track has a description', () => {
    const cmd = createTrackCommand(null, db);
    expect(cmd.description()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Behaviour tests (reuse lookup logic — moved here from old lookup.test.ts)
// ---------------------------------------------------------------------------

describe('track lookup — URL resolution', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = await setupDb();
    await db.addRelease(release);
    await db.saveCachedTrackMatch(7001, 'Miles Runs the Voodoo Down', '888111', 0.9, 'Miles Runs the Voodoo Down', 'milesdavis');
    await db.createPlaylist('pl-brew', 'Fusion Nights');
    await db.addReleaseToPlaylist('pl-brew', 7001, '888111');
  });
  afterEach(async () => { await db.close(); });

  test('valid SoundCloud URL is resolved via /resolve API (not regex)', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 888111, title: 'Miles Runs the Voodoo Down', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync(['https://soundcloud.com/milesdavis/miles-runs'], { from: 'user' }); } catch {}

    expect(client.resolveUrl).toHaveBeenCalledWith('https://soundcloud.com/milesdavis/miles-runs');
    consoleSpy.mockRestore(); exitSpy.mockRestore();
  });

  test('URL with query params passes the full URL to resolveUrl', async () => {
    const url = 'https://soundcloud.com/milesdavis/miles-runs?in=milesdavis/sets/brew&si=xyz';
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 888111, title: 'Miles Runs the Voodoo Down', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync([url], { from: 'user' }); } catch {}

    expect(client.resolveUrl).toHaveBeenCalledWith(url);
    consoleSpy.mockRestore(); exitSpy.mockRestore();
  });

  test('URL returning 404 produces a clear not-found message and exits 0', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockRejectedValue(new Error('404 Not Found')),
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync(['https://soundcloud.com/unknown/track'], { from: 'user' }); } catch {}

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Track not found on SoundCloud'));
    exitSpy.mockRestore(); errorSpy.mockRestore();
  });

  test('track ID not in local DB outputs "Track not found in local database"', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 999999, title: 'Unknown', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync(['https://soundcloud.com/artist/unknown'], { from: 'user' }); } catch {}

    const output = consoleSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Track not found in local database');
    consoleSpy.mockRestore(); exitSpy.mockRestore();
  });

  test('output includes Discogs release URL in correct format', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 888111, title: 'Miles Runs the Voodoo Down', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync(['https://soundcloud.com/milesdavis/miles-runs'], { from: 'user' }); } catch {}

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('https://www.discogs.com/release/7001');
    consoleSpy.mockRestore(); exitSpy.mockRestore();
  });

  test('output is plain text, not JSON', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 888111, title: 'Miles Runs the Voodoo Down', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try { await cmd.parseAsync(['https://soundcloud.com/milesdavis/miles-runs'], { from: 'user' }); } catch {}

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output.trim()).not.toMatch(/^[\[{]/);
    consoleSpy.mockRestore(); exitSpy.mockRestore();
  });
});
