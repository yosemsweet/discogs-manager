import { Command } from 'commander';
import chalk from 'chalk';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { SoundCloudOAuthService } from '../services/soundcloud-oauth';
import { DatabaseManager } from '../services/database';
import { PlaylistService } from '../services/playlist';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { PlaylistFilter } from '../types';
import { CommandBuilder } from '../utils/command-builder';
import { Validator, ValidationError } from '../utils/validator';
import { EncryptionService } from '../utils/encryption';
import { InputSanitizer } from '../utils/sanitizer';
import { Logger, LogLevel } from '../utils/logger';
import { createReviewCommand, createUnmatchedCommand, createResetCommand, createDeleteCommand } from './review';
import { createExportCommand } from './export';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Add all playlist filter options to a command. */
function addPlaylistFilterOptions(cmd: Command): Command {
  return cmd
    .requiredOption('-t, --title <title>', 'Playlist title')
    .option('-d, --description <description>', 'Playlist description')
    .option('-g, --genres <genres>', 'Comma-separated genres to include')
    .option('-s, --styles <styles>', 'Comma-separated styles to include')
    .option('-a, --artists <artists>', 'Comma-separated artists to include')
    .option('-l, --labels <labels>', 'Comma-separated labels to include')
    .option('--release-ids <ids>', 'Comma-separated Discogs release IDs (for testing)')
    .option('--min-year <year>', 'Minimum year')
    .option('--max-year <year>', 'Maximum year')
    .option('--private', 'Create as private playlist')
    .option('--acquired-after <date>', 'Only include releases acquired on or after this date (YYYY-MM-DD)')
    .option('--acquired-before <date>', 'Only include releases acquired on or before this date (YYYY-MM-DD)')
    .option('-v, --verbose', 'Show detailed matching/search debug output');
}

/** Shared action body for `playlist create` and `playlist update`. */
async function runPlaylistAction(
  options: any,
  discogsClient: DiscogsAPIClient,
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
): Promise<void> {
  const spinner = CommandBuilder.createSpinner();

  try {
    // Enable debug logging when --verbose is passed
    if (options.verbose) {
      Logger.setLogLevel(LogLevel.DEBUG);
    }

    // Sanitize input options for security
    if (options.title) {
      const sanitized = InputSanitizer.sanitizePlaylistName(options.title);
      if (!sanitized) {
        throw new ValidationError('title', 'Playlist title sanitization failed');
      }
      options.title = sanitized;
    }

    if (options.description) {
      const sanitized = InputSanitizer.normalizeString(options.description, 500);
      if (!sanitized) {
        throw new ValidationError('description', 'Description sanitization failed');
      }
      options.description = sanitized;
    }

    if (options.genres) {
      const sanitized = InputSanitizer.sanitizeSearchQuery(options.genres);
      if (!sanitized) {
        throw new ValidationError('genres', 'Genres filter sanitization failed');
      }
      options.genres = sanitized;
    }

    if (options.styles) {
      const sanitized = InputSanitizer.sanitizeSearchQuery(options.styles);
      if (!sanitized) {
        throw new ValidationError('styles', 'Styles filter sanitization failed');
      }
      options.styles = sanitized;
    }

    if (options.artists) {
      const sanitized = InputSanitizer.sanitizeSearchQuery(options.artists);
      if (!sanitized) {
        throw new ValidationError('artists', 'Artists filter sanitization failed');
      }
      options.artists = sanitized;
    }

    if (options.labels) {
      const sanitized = InputSanitizer.sanitizeSearchQuery(options.labels);
      if (!sanitized) {
        throw new ValidationError('labels', 'Labels filter sanitization failed');
      }
      options.labels = sanitized;
    }

    // Check for suspicious patterns
    if (options.title && InputSanitizer.isSuspicious(options.title)) {
      Logger.warn('Suspicious playlist title pattern detected', { title: options.title });
      throw new ValidationError('title', 'Playlist title contains suspicious patterns');
    }

    spinner.text = 'Checking SoundCloud rate limits...';
    const rateLimitService = new SoundCloudRateLimitService(db);
    await rateLimitService.initializeFromDatabase();

    // Lazy-load SoundCloud client if not provided
    let clientToUse = soundcloudClient;
    if (!clientToUse) {
      spinner.text = 'Loading SoundCloud authentication from database...';
      try {
        const encryptionService = new EncryptionService(process.env.ENCRYPTION_KEY);
        const oauthService = new SoundCloudOAuthService(
          process.env.SOUNDCLOUD_CLIENT_ID || '',
          process.env.SOUNDCLOUD_CLIENT_SECRET || '',
          'http://localhost:8080/callback',
          db,
          encryptionService
        );
        spinner.text = 'Retrieving access token...';
        const token = await oauthService.getValidAccessToken();
        clientToUse = new SoundCloudAPIClient(token, rateLimitService);
        spinner.text = '';
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `SoundCloud authentication failed: ${errorMsg}\n   Please run: discogs-cli soundcloud auth`
        );
      }
    }

    // Commander maps --acquired-after → options.acquiredAfter automatically
    const validated = Validator.validatePlaylistOptions(options);

    const collectionService = new CollectionService(discogsClient, db);
    const playlistService = new PlaylistService(clientToUse, db, rateLimitService);
    const progressCallback = CommandBuilder.createProgressCallback(spinner);

    let releases;

    if (validated.releaseIds) {
      spinner.text = 'Fetching specified releases...';
      releases = await Promise.all(validated.releaseIds.map((id: number) => db.getReleaseByDiscogsId(id)));
      releases = releases.filter((r) => r !== null);
    } else {
      releases = await collectionService.filterReleases(validated.filter, progressCallback);
    }

    if (releases.length === 0) {
      throw new Error('No releases match the criteria');
    }

    const playlist = await playlistService.createPlaylist(
      validated.title,
      releases,
      validated.description,
      progressCallback
    );

    const unmatchedCounts = await db.countUnmatchedTracks(validated.title);
    const unmatchedInfo = unmatchedCounts.pending > 0
      ? chalk.yellow(`\n   ${unmatchedCounts.pending} track(s) could not be matched automatically — run:\n   discogs-cli playlist tracks review --title "${validated.title}"`)
      : '';

    spinner.succeed(
      CommandBuilder.formatSuccess(
        `Playlist "${options.title}" created with ${playlist.trackCount} tracks`
      ) + unmatchedInfo
    );
    console.log(chalk.gray(`Playlist ID: ${playlist.id}`));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('rate limit')) {
      spinner.fail(
        chalk.red(`✗ SoundCloud rate limit exceeded.\n   ${message}\n   Please try again later.`)
      );
    } else {
      spinner.fail(CommandBuilder.formatError(`Failed to create playlist: ${message}`));
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// `playlist tracks` subgroup
// ---------------------------------------------------------------------------

function createTracksCommand(
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
): Command {
  const tracksCmd = new Command('tracks')
    .description('Manage tracks in a playlist')
    .option('-t, --title <title>', 'Playlist title')
    .action(async (options) => {
      if (!options.title) {
        tracksCmd.help();
        return;
      }
      // List matched tracks for the playlist
      const playlist = await db.getPlaylistByTitle(options.title);
      if (!playlist) {
        console.error(chalk.red(`No playlist found with title "${options.title}".`));
        process.exit(1);
      }
      const tracks = await db.getPlaylistExportMatched(playlist.id);
      const unmatched = await db.countUnmatchedTracks(options.title);

      console.log(chalk.bold(`\nTracks in "${options.title}"\n`));
      console.log(chalk.gray(`Matched: ${tracks.length}  Unmatched (pending): ${unmatched.pending}\n`));
      tracks.forEach((t) => {
        console.log(`  ${chalk.cyan(t.discogs_track)} — ${chalk.gray(t.soundcloud_track || t.soundcloud_track_id)}`);
      });
      if (tracks.length === 0) {
        console.log(chalk.gray('  No matched tracks yet.'));
      }
      console.log();
      process.exit(0);
    });

  tracksCmd.addCommand(createReviewCommand(soundcloudClient, db));
  tracksCmd.addCommand(createUnmatchedCommand(db));
  tracksCmd.addCommand(createResetCommand(db));

  return tracksCmd;
}

// ---------------------------------------------------------------------------
// Main `playlist` command
// ---------------------------------------------------------------------------

export function createPlaylistCommand(
  discogsClient: DiscogsAPIClient,
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
) {
  const cmd = new Command('playlist')
    .description('Manage SoundCloud playlists')
    .enablePositionalOptions()
    .allowUnknownOption()
    .action(() => {
      // Detect old-style invocation: playlist --title "..." with no subcommand
      if (process.argv.includes('--title') || process.argv.includes('-t')) {
        const idx = Math.max(process.argv.indexOf('--title'), process.argv.indexOf('-t'));
        const title = process.argv[idx + 1] || '';
        console.error(
          `Did you mean: playlist create --title "${title}" or playlist update --title "${title}"?`
        );
        process.exit(1);
      }
      cmd.help();
    });

  // create subcommand
  const createCmd = addPlaylistFilterOptions(new Command('create')
    .description('Create a new SoundCloud playlist from your collection'));
  createCmd.action((options) => runPlaylistAction(options, discogsClient, soundcloudClient, db));
  cmd.addCommand(createCmd);

  // update subcommand (same underlying logic — create-or-update)
  const updateCmd = addPlaylistFilterOptions(new Command('update')
    .description('Update an existing SoundCloud playlist'));
  updateCmd.action((options) => runPlaylistAction(options, discogsClient, soundcloudClient, db));
  cmd.addCommand(updateCmd);

  // tracks subgroup
  cmd.addCommand(createTracksCommand(soundcloudClient, db));

  // delete and export remain direct subcommands of playlist
  cmd.addCommand(createDeleteCommand(soundcloudClient, db));
  cmd.addCommand(createExportCommand(db));

  // Stubs for removed direct paths — guide users to the new location
  for (const name of ['review', 'unmatched', 'reset'] as const) {
    cmd.addCommand(
      new Command(name)
        .description(`(moved) Use: playlist tracks ${name}`)
        .allowUnknownOption()
        .action(() => {
          console.error(`Did you mean: playlist tracks ${name}?`);
          process.exit(1);
        })
    );
  }

  return cmd;
}
