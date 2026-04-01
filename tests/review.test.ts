import { parseTrackInput, resolveTrack } from '../src/commands/review';
import { DatabaseManager } from '../src/services/database';
import { PlaylistBatchManager } from '../src/services/playlist-batch';

// Mock chalk and ora to avoid ES module issues
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
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    text: '',
  }),
}));

describe('parseTrackInput', () => {
  test('full SoundCloud URL returns type url', () => {
    const result = parseTrackInput('https://soundcloud.com/artist/track-name');
    expect(result).toEqual({ type: 'url', url: 'https://soundcloud.com/artist/track-name' });
  });

  test('SoundCloud URL with query params returns type url (not regex-extracted)', () => {
    const url = 'https://soundcloud.com/rosaliaofficial/la-rumba-del-perdon?in=rosaliaofficial/sets/lux-226901126&si=abc123';
    const result = parseTrackInput(url);
    expect(result).toEqual({ type: 'url', url });
  });

  test('plain numeric string returns type id', () => {
    const result = parseTrackInput('12345678');
    expect(result).toEqual({ type: 'id', id: '12345678' });
  });

  test('non-SoundCloud URL returns invalid', () => {
    const result = parseTrackInput('https://spotify.com/track/123');
    expect(result).toEqual({ type: 'invalid' });
  });

  test('empty input returns invalid', () => {
    expect(parseTrackInput('')).toEqual({ type: 'invalid' });
  });

  test('whitespace-only input returns invalid', () => {
    expect(parseTrackInput('   ')).toEqual({ type: 'invalid' });
  });

  test('mixed text like "track 123" returns invalid', () => {
    expect(parseTrackInput('track 123')).toEqual({ type: 'invalid' });
  });

  test('trims whitespace from URL input', () => {
    const result = parseTrackInput('  https://soundcloud.com/artist/track  ');
    expect(result).toEqual({ type: 'url', url: 'https://soundcloud.com/artist/track' });
  });

  test('trims whitespace from numeric input', () => {
    const result = parseTrackInput('  99999  ');
    expect(result).toEqual({ type: 'id', id: '99999' });
  });
});

describe('resolveTrack', () => {
  let dbMock: jest.Mocked<Pick<DatabaseManager, 'getPlaylistTracks' | 'saveCachedTrackMatch' | 'addReleaseToPlaylist' | 'resolveUnmatchedTrack'>>;
  let batchManagerMock: jest.Mocked<Pick<PlaylistBatchManager, 'addTracksInBatches'>>;

  beforeEach(() => {
    dbMock = {
      getPlaylistTracks: jest.fn().mockResolvedValue([]),
      saveCachedTrackMatch: jest.fn().mockResolvedValue(undefined),
      addReleaseToPlaylist: jest.fn().mockResolvedValue(undefined),
      resolveUnmatchedTrack: jest.fn().mockResolvedValue(undefined),
    };
    batchManagerMock = {
      addTracksInBatches: jest.fn().mockResolvedValue(undefined),
    };
  });

  test('PUT includes all existing playlist tracks plus the new one', async () => {
    dbMock.getPlaylistTracks.mockResolvedValue([
      { soundcloudTrackId: 'existing-1', releaseId: 100 },
      { soundcloudTrackId: 'existing-2', releaseId: 101 },
    ]);

    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      1, // unmatchedId
      'new-track-456',
      200, // discogsReleaseId
      'Some Track Title',
      'db-playlist-id'
    );

    expect(batchManagerMock.addTracksInBatches).toHaveBeenCalledWith(
      'sc-playlist-123',
      ['existing-1', 'existing-2', 'new-track-456']
    );
  });

  test('with 0 existing tracks, PUT sends only the newly resolved track', async () => {
    dbMock.getPlaylistTracks.mockResolvedValue([]);

    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      1,
      'new-track-789',
      200,
      'Track Title',
      'db-playlist-id'
    );

    expect(batchManagerMock.addTracksInBatches).toHaveBeenCalledWith(
      'sc-playlist-123',
      ['new-track-789']
    );
  });

  test('deduplicates if new track already exists in playlist', async () => {
    dbMock.getPlaylistTracks.mockResolvedValue([
      { soundcloudTrackId: 'track-1', releaseId: 100 },
      { soundcloudTrackId: 'track-2', releaseId: 101 },
    ]);

    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      1,
      'track-2', // already exists
      200,
      'Track Title',
      'db-playlist-id'
    );

    expect(batchManagerMock.addTracksInBatches).toHaveBeenCalledWith(
      'sc-playlist-123',
      ['track-1', 'track-2'] // no duplicate
    );
  });

  test('resolveUnmatchedTrack is called with the correct track ID', async () => {
    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      42, // unmatchedId
      'correct-track-id',
      200,
      'Track Title',
      'db-playlist-id'
    );

    expect(dbMock.resolveUnmatchedTrack).toHaveBeenCalledWith(42, 'correct-track-id');
  });

  test('addReleaseToPlaylist stores the correct track ID', async () => {
    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      1,
      'the-track-id',
      555, // discogsReleaseId
      'Track Title',
      'my-playlist-db-id'
    );

    expect(dbMock.addReleaseToPlaylist).toHaveBeenCalledWith('my-playlist-db-id', 555, 'the-track-id');
  });

  test('saveCachedTrackMatch stores the resolved track for cache', async () => {
    await resolveTrack(
      dbMock as any,
      batchManagerMock as any,
      'sc-playlist-123',
      1,
      'cached-track-id',
      300,
      'My Track Title',
      'db-playlist-id'
    );

    expect(dbMock.saveCachedTrackMatch).toHaveBeenCalledWith(
      300,
      'My Track Title',
      'cached-track-id',
      1.0,
      'My Track Title',
      undefined
    );
  });
});
