import fs from 'fs';
import path from 'path';
import os from 'os';
import { csvEscape, buildCsvRow, generatePlaylistCsv, createExportCommand } from '../src/commands/export';
import { DatabaseManager } from '../src/services/database';
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
// CSV generation (unit)
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  test('plain value is returned as-is', () => {
    expect(csvEscape('hello')).toBe('hello');
  });

  test('value with comma is quoted', () => {
    expect(csvEscape('hello, world')).toBe('"hello, world"');
  });

  test('value with double-quote is quoted and internal quote doubled (RFC 4180)', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  test('value with newline is quoted', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  test('value with carriage return is quoted', () => {
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  test('empty string is returned as empty string', () => {
    expect(csvEscape('')).toBe('');
  });
});

describe('buildCsvRow', () => {
  test('joins fields with commas', () => {
    expect(buildCsvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  test('escapes fields containing commas', () => {
    expect(buildCsvRow(['Artist, The', 'Album', 'Track'])).toBe('"Artist, The",Album,Track');
  });
});

// ---------------------------------------------------------------------------
// generatePlaylistCsv — uses an in-memory database
// ---------------------------------------------------------------------------

describe('generatePlaylistCsv', () => {
  let db: DatabaseManager;

  const release: StoredRelease = {
    discogsId: 1001,
    title: 'Blue Note Sessions',
    artists: 'Miles Davis',
    year: 1960,
    genres: 'Jazz',
    styles: 'Modal',
    condition: 'VG+',
    rating: 5,
    addedAt: new Date(),
  };

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;

    // Set up a playlist with one matched and one unmatched track
    await db.addRelease(release);
    await db.createPlaylist('playlist-1', 'My Jazz');
    await db.addReleaseToPlaylist('playlist-1', 1001, 'sc-track-999');
    await db.saveCachedTrackMatch(1001, 'So What', 'sc-track-999', 0.92, 'So What (Live)', 'miles_davis');
    await db.saveUnmatchedTrack({
      playlistTitle: 'My Jazz',
      discogsReleaseId: 1001,
      discogsTrackTitle: 'Flamenco Sketches',
      discogsArtist: 'Miles Davis',
      releaseTitle: 'Blue Note Sessions',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  test('headers are always the first row', async () => {
    const csv = await generatePlaylistCsv(db, 'My Jazz');
    const rows = csv.trimEnd().split('\n');
    expect(rows[0]).toBe('discogs_artist,discogs_release,discogs_track,soundcloud_track,soundcloud_url,confidence,status,include');
  });

  test('headers are written even when no tracks exist', async () => {
    await db.createPlaylist('empty-pl', 'Empty Playlist');
    const csv = await generatePlaylistCsv(db, 'Empty Playlist');
    const rows = csv.trimEnd().split('\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('discogs_artist');
  });

  test('matched track produces correct row with all fields populated', async () => {
    const csv = await generatePlaylistCsv(db, 'My Jazz');
    const rows = csv.trimEnd().split('\n');
    // Row 1 = header, Row 2 = matched track
    const matchedRow = rows[1];
    expect(matchedRow).toContain('Miles Davis');
    expect(matchedRow).toContain('Blue Note Sessions');
    expect(matchedRow).toContain('So What');
    expect(matchedRow).toContain('So What (Live)');
    expect(matchedRow).toContain('https://soundcloud.com/tracks/sc-track-999');
    expect(matchedRow).toContain('0.92');
    expect(matchedRow).toContain('matched');
  });

  test('unmatched track has empty soundcloud_track, soundcloud_url, and confidence', async () => {
    const csv = await generatePlaylistCsv(db, 'My Jazz');
    const rows = csv.trimEnd().split('\n');
    // Row 2 = matched, Row 3 = unmatched (alphabetically: Flamenco after So What at release level, but both same release)
    const unmatchedRow = rows.find(r => r.includes('Flamenco Sketches'));
    expect(unmatchedRow).toBeDefined();
    // Parse the row: the last 5 fields should be: '', '', '', 'unmatched', ''
    const fields = unmatchedRow!.split(',');
    expect(fields[fields.length - 1]).toBe('');  // include (blank for unmatched)
    expect(fields[fields.length - 2]).toBe('unmatched');  // status
    expect(fields[fields.length - 3]).toBe('');  // confidence
    expect(fields[fields.length - 4]).toBe('');  // soundcloud_url
    expect(fields[fields.length - 5]).toBe('');  // soundcloud_track
  });

  test('matched tracks appear before unmatched tracks', async () => {
    const csv = await generatePlaylistCsv(db, 'My Jazz');
    const rows = csv.trimEnd().split('\n').slice(1); // drop header
    const matchedIdx = rows.findIndex(r => r.includes('matched') && !r.includes('unmatched'));
    const unmatchedIdx = rows.findIndex(r => r.includes('unmatched'));
    expect(matchedIdx).toBeLessThan(unmatchedIdx);
  });

  test('values containing commas are properly RFC-4180 escaped', async () => {
    const releaseWithComma: StoredRelease = {
      discogsId: 1002,
      title: 'Vol. 1, Side A',
      artists: 'Smith, John',
      year: 1970,
      genres: 'Rock',
      styles: '',
      condition: 'G',
      rating: 3,
      addedAt: new Date(),
    };
    await db.addRelease(releaseWithComma);
    await db.createPlaylist('playlist-2', 'Rock List');
    await db.addReleaseToPlaylist('playlist-2', 1002, 'sc-track-888');
    await db.saveCachedTrackMatch(1002, 'Track One', 'sc-track-888', 0.8, 'Track One', undefined);

    const csv = await generatePlaylistCsv(db, 'Rock List');
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"Vol. 1, Side A"');
  });

  test('values containing double-quotes are properly escaped', async () => {
    const releaseWithQuote: StoredRelease = {
      discogsId: 1003,
      title: 'The "Real" Deal',
      artists: 'Artist',
      year: 1975,
      genres: 'Soul',
      styles: '',
      condition: 'VG',
      rating: 4,
      addedAt: new Date(),
    };
    await db.addRelease(releaseWithQuote);
    await db.createPlaylist('playlist-3', 'Soul List');
    await db.addReleaseToPlaylist('playlist-3', 1003, 'sc-track-777');
    await db.saveCachedTrackMatch(1003, 'Track A', 'sc-track-777', 0.75, 'Track A', undefined);

    const csv = await generatePlaylistCsv(db, 'Soul List');
    expect(csv).toContain('"The ""Real"" Deal"');
  });

  test('throws a clear error when playlist is not found', async () => {
    await expect(generatePlaylistCsv(db, 'Nonexistent Playlist')).rejects.toThrow(
      'Playlist "Nonexistent Playlist" not found in local database'
    );
  });

  test('export reads only from database — no SoundCloud client required', async () => {
    // generatePlaylistCsv takes only db, not soundcloudClient — this test
    // verifies the function signature accepts no SoundCloud dependency
    const csv = await generatePlaylistCsv(db, 'My Jazz');
    expect(csv).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

describe('createExportCommand — file output', () => {
  let db: DatabaseManager;
  let tmpDir: string;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await (db as any).initialized;

    const release: StoredRelease = {
      discogsId: 2001,
      title: 'Test Album',
      artists: 'Test Artist',
      year: 2000,
      genres: 'Electronic',
      styles: '',
      condition: 'M',
      rating: 5,
      addedAt: new Date(),
    };
    await db.addRelease(release);
    await db.createPlaylist('pl-file', 'File Test');
    await db.addReleaseToPlaylist('pl-file', 2001, 'sc-99');
    await db.saveCachedTrackMatch(2001, 'Track X', 'sc-99', 0.9, 'Track X', undefined);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discogs-export-test-'));
  });

  afterEach(async () => {
    await db.close();
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  test('when --out is provided, CSV is written to the specified path', async () => {
    const outPath = path.join(tmpDir, 'output.csv');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = createExportCommand(db);
    try {
      await cmd.parseAsync(['--title', 'File Test', '--out', outPath], { from: 'user' });
    } catch (e) { /* process.exit throws in mock */ }

    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('discogs_artist');
    expect(content).toContain('Track X');

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('when --out is omitted, CSV is written to stdout', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createExportCommand(db);
    try {
      await cmd.parseAsync(['--title', 'File Test'], { from: 'user' });
    } catch (e) { /* process.exit */ }

    const written = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(written).toContain('discogs_artist');
    expect(written).toContain('Track X');

    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('writing to a path whose parent directory does not exist produces a clear error', async () => {
    const outPath = path.join(tmpDir, 'nonexistent-dir', 'output.csv');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = createExportCommand(db);
    try {
      await cmd.parseAsync(['--title', 'File Test', '--out', outPath], { from: 'user' });
    } catch (e) { /* process.exit */ }

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Directory does not exist'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
