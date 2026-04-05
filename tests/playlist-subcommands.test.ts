import { createPlaylistCommand } from '../src/commands/playlist';
import { DiscogsAPIClient } from '../src/api/discogs';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { DatabaseManager } from '../src/services/database';

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
const mockDb = {
  initialized: Promise.resolve(),
  getPlaylistByTitle: jest.fn(),
  getPlaylistExportMatched: jest.fn().mockResolvedValue([]),
  countUnmatchedTracks: jest.fn().mockResolvedValue({ pending: 0, resolved: 0, skipped: 0 }),
  getUnmatchedTracks: jest.fn().mockResolvedValue([]),
} as unknown as DatabaseManager;

function getPlaylist() {
  return createPlaylistCommand(mockDiscogsClient, mockSoundCloudClient, mockDb);
}

// ---------------------------------------------------------------------------
// Subcommand structure
// ---------------------------------------------------------------------------

describe('playlist command structure', () => {
  test('playlist command is named "playlist"', () => {
    expect(getPlaylist().name()).toBe('playlist');
  });

  test('playlist has "create" subcommand', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('create');
  });

  test('playlist has "update" subcommand', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('update');
  });

  test('playlist has "delete" subcommand', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('delete');
  });

  test('playlist has "export" subcommand', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('export');
  });

  test('playlist has "tracks" subcommand', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('tracks');
  });

  test('playlist does not have "review" as a real subcommand (stub only)', () => {
    // review exists as a stub but should redirect, not behave like the real command
    const reviewCmd = getPlaylist().commands.find(c => c.name() === 'review');
    expect(reviewCmd).toBeDefined(); // stub exists
  });
});

// ---------------------------------------------------------------------------
// playlist create / update flags
// ---------------------------------------------------------------------------

describe('playlist create flags', () => {
  function getCreate() {
    return getPlaylist().commands.find(c => c.name() === 'create')!;
  }

  test('has -t/--title as required option', () => {
    const opt = getCreate().options.find(o => o.long === '--title');
    expect(opt).toBeDefined();
    expect(opt?.short).toBe('-t');
    expect(opt?.mandatory).toBe(true);
  });

  test('has -d/--description option', () => {
    expect(getCreate().options.some(o => o.long === '--description')).toBe(true);
  });

  test('has -g/--genres option', () => {
    expect(getCreate().options.some(o => o.long === '--genres')).toBe(true);
  });

  test('has -s/--styles option', () => {
    expect(getCreate().options.some(o => o.long === '--styles')).toBe(true);
  });

  test('has -a/--artists option', () => {
    expect(getCreate().options.some(o => o.long === '--artists')).toBe(true);
  });

  test('has -l/--labels option', () => {
    expect(getCreate().options.some(o => o.long === '--labels')).toBe(true);
  });

  test('has --min-year and --max-year options', () => {
    expect(getCreate().options.some(o => o.long === '--min-year')).toBe(true);
    expect(getCreate().options.some(o => o.long === '--max-year')).toBe(true);
  });

  test('has --private option', () => {
    expect(getCreate().options.some(o => o.long === '--private')).toBe(true);
  });

  test('has --acquired-after (hyphen, not underscore)', () => {
    expect(getCreate().options.some(o => o.long === '--acquired-after')).toBe(true);
    expect(getCreate().options.some(o => o.long === '--acquired_after')).toBe(false);
  });

  test('has --acquired-before (hyphen, not underscore)', () => {
    expect(getCreate().options.some(o => o.long === '--acquired-before')).toBe(true);
    expect(getCreate().options.some(o => o.long === '--acquired_before')).toBe(false);
  });

  test('has -v/--verbose option', () => {
    const opt = getCreate().options.find(o => o.long === '--verbose');
    expect(opt?.short).toBe('-v');
  });
});

describe('playlist update flags', () => {
  function getUpdate() {
    return getPlaylist().commands.find(c => c.name() === 'update')!;
  }

  test('has -t/--title as required option', () => {
    const opt = getUpdate().options.find(o => o.long === '--title');
    expect(opt).toBeDefined();
    expect(opt?.mandatory).toBe(true);
  });

  test('has same filter flags as create', () => {
    const flags = ['--genres', '--styles', '--artists', '--labels', '--min-year', '--max-year',
                   '--private', '--acquired-after', '--acquired-before', '--verbose'];
    flags.forEach(flag => {
      expect(getUpdate().options.some(o => o.long === flag)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// playlist tracks subgroup
// ---------------------------------------------------------------------------

describe('playlist tracks subgroup', () => {
  function getTracks() {
    return getPlaylist().commands.find(c => c.name() === 'tracks')!;
  }

  test('playlist tracks is a subcommand of playlist', () => {
    expect(getTracks()).toBeDefined();
  });

  test('playlist tracks has review subcommand', () => {
    expect(getTracks().commands.map(c => c.name())).toContain('review');
  });

  test('playlist tracks has unmatched subcommand', () => {
    expect(getTracks().commands.map(c => c.name())).toContain('unmatched');
  });

  test('playlist tracks has reset subcommand', () => {
    expect(getTracks().commands.map(c => c.name())).toContain('reset');
  });

  test('playlist tracks unmatched has --status and --json flags', () => {
    const unmatched = getTracks().commands.find(c => c.name() === 'unmatched')!;
    expect(unmatched.options.some(o => o.long === '--status')).toBe(true);
    expect(unmatched.options.some(o => o.long === '--json')).toBe(true);
  });

  test('playlist tracks reset has --status and --id flags', () => {
    const reset = getTracks().commands.find(c => c.name() === 'reset')!;
    expect(reset.options.some(o => o.long === '--status')).toBe(true);
    expect(reset.options.some(o => o.long === '--id')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// delete and export stay on playlist, not tracks
// ---------------------------------------------------------------------------

describe('delete and export placement', () => {
  test('delete is a direct subcommand of playlist', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('delete');
  });

  test('export is a direct subcommand of playlist', () => {
    expect(getPlaylist().commands.map(c => c.name())).toContain('export');
  });

  test('delete is not under tracks', () => {
    const tracks = getPlaylist().commands.find(c => c.name() === 'tracks')!;
    expect(tracks.commands.map(c => c.name())).not.toContain('delete');
  });

  test('export is not under tracks', () => {
    const tracks = getPlaylist().commands.find(c => c.name() === 'tracks')!;
    expect(tracks.commands.map(c => c.name())).not.toContain('export');
  });
});

// ---------------------------------------------------------------------------
// Old direct paths redirect via stubs
// ---------------------------------------------------------------------------

describe('removed direct paths show "did you mean?" message', () => {
  const stubs = ['review', 'unmatched', 'reset'];

  stubs.forEach(name => {
    test(`playlist ${name} exits 1 with a "did you mean?" message`, async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      const cmd = getPlaylist();
      try {
        await cmd.parseAsync([name], { from: 'user' });
      } catch {}

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`playlist tracks ${name}`));
      expect(exitSpy).toHaveBeenCalledWith(1);
      errorSpy.mockRestore(); exitSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Old-style playlist --title invocation
// ---------------------------------------------------------------------------

describe('playlist --title with no subcommand shows deprecation hint', () => {
  test('exits 1 with "did you mean: playlist create / update?" message', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const origArgv = process.argv;
    process.argv = ['node', 'discogs-cli', 'playlist', '--title', 'My Jazz'];

    const cmd = getPlaylist();
    try {
      await cmd.parseAsync(['--title', 'My Jazz'], { from: 'user' });
    } catch {}

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('playlist create'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('playlist update'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    process.argv = origArgv;
    errorSpy.mockRestore(); exitSpy.mockRestore();
  });
});
