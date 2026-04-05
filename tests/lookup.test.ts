import { createLookupCommand } from '../src/commands/lookup';
import { DatabaseManager } from '../src/services/database';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { StoredRelease } from '../src/types';

jest.mock('chalk', () => ({
  __esModule: true,
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    gray: (s: string) => s,
    bold: (s: string) => s,
  },
}));

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: '',
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient(overrides: Partial<SoundCloudAPIClient> = {}): SoundCloudAPIClient {
  return {
    resolveUrl: jest.fn(),
    ...overrides,
  } as unknown as SoundCloudAPIClient;
}

async function setupDb(): Promise<DatabaseManager> {
  const db = new DatabaseManager(':memory:');
  await (db as any).initialized;
  return db;
}

const release: StoredRelease = {
  discogsId: 5001,
  title: 'Kind of Blue',
  artists: 'Miles Davis',
  year: 1959,
  genres: 'Jazz',
  styles: 'Modal',
  condition: 'VG+',
  rating: 5,
  addedAt: new Date(),
};

// ---------------------------------------------------------------------------
// URL resolution tests
// ---------------------------------------------------------------------------

describe('lookup — URL resolution', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = await setupDb();
    await db.addRelease(release);
    await db.saveCachedTrackMatch(5001, 'So What', '111222', 0.95, 'So What', 'miles_davis');
    await db.createPlaylist('pl-jazz', 'My Jazz');
    await db.addReleaseToPlaylist('pl-jazz', 5001, '111222');
  });

  afterEach(async () => { await db.close(); });

  test('a valid SoundCloud track URL is resolved via /resolve API (not regex)', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    expect(client.resolveUrl).toHaveBeenCalledWith('https://soundcloud.com/miles_davis/so-what');
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a URL with query parameters resolves to the correct track ID (not a set/playlist ID)', async () => {
    const url = 'https://soundcloud.com/miles_davis/so-what?in=miles_davis/sets/kind-of-blue&si=abc123';
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync([url], { from: 'user' });
    } catch { /* process.exit */ }

    // The full URL (with query params) is passed to resolveUrl — extraction is done server-side
    expect(client.resolveUrl).toHaveBeenCalledWith(url);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('So What');
    expect(output).toContain('Kind of Blue');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a URL that returns 404 produces a clear not-found error message', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockRejectedValue(new Error('404 Not Found')),
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/unknown/track'], { from: 'user' });
    } catch { /* process.exit */ }

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Track not found on SoundCloud'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a network error produces a clear error message', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockRejectedValue(new Error('Network timeout')),
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/artist/track'], { from: 'user' });
    } catch { /* process.exit */ }

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve URL'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Local database lookup
// ---------------------------------------------------------------------------

describe('lookup — local database lookup', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = await setupDb();
    await db.addRelease(release);
    await db.saveCachedTrackMatch(5001, 'So What', '111222', 0.95, 'So What', 'miles_davis');
    await db.createPlaylist('pl-jazz', 'My Jazz');
    await db.addReleaseToPlaylist('pl-jazz', 5001, '111222');
  });

  afterEach(async () => { await db.close(); });

  test('resolved track ID found in track_matches returns correct Discogs artist, track title, release title', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('So What');
    expect(output).toContain('Miles Davis');
    expect(output).toContain('Kind of Blue');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('output includes the Discogs release URL in the correct format', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('https://www.discogs.com/release/5001');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('playlist titles the track appears in are listed', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('My Jazz');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a track appearing in multiple playlists lists all of them', async () => {
    await db.createPlaylist('pl-modal', 'Modal Nights');
    await db.addReleaseToPlaylist('pl-modal', 5001, '111222');

    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('My Jazz');
    expect(output).toContain('Modal Nights');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a resolved track ID not present in track_matches outputs "Track not found in local database"', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 999999, title: 'Unknown', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/artist/unknown'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Track not found in local database');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('a track matched to a release but not in any playlist outputs "Not in any playlists"', async () => {
    // Add a track match that is NOT in any playlist
    await db.saveCachedTrackMatch(5001, 'Flamenco Sketches', '333444', 0.88, 'Flamenco Sketches', 'miles_davis');
    // Do NOT add to any playlist

    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 333444, title: 'Flamenco Sketches', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/flamenco-sketches'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Not in any playlists');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('output is plain text (not JSON)', async () => {
    const client = makeMockClient({
      resolveUrl: jest.fn().mockResolvedValue({ id: 111222, title: 'So What', kind: 'track' }),
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createLookupCommand(client, db);
    try {
      await cmd.parseAsync(['https://soundcloud.com/miles_davis/so-what'], { from: 'user' });
    } catch { /* process.exit */ }

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    // Should not be JSON (no leading { or [)
    expect(output.trim()).not.toMatch(/^[\[{]/);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
