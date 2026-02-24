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
import { Logger } from '../utils/logger';
import { createReviewCommand, createUnmatchedCommand } from './review';

export function createPlaylistCommand(
  discogsClient: DiscogsAPIClient,
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
) {
  const cmd = new Command('playlist')
    .description('Create SoundCloud playlists from your collection')
    .option('-t, --title <title>', 'Playlist title')
    .option('-d, --description <description>', 'Playlist description')
    .option('-g, --genres <genres>', 'Comma-separated genres to include')
    .option('-s, --styles <styles>', 'Comma-separated styles to include')
    .option('-a, --artists <artists>', 'Comma-separated artists to include')
    .option('-l, --labels <labels>', 'Comma-separated labels to include')
    .option('--release-ids <ids>', 'Comma-separated Discogs release IDs (for testing)')
    .option('--min-year <year>', 'Minimum year')
    .option('--max-year <year>', 'Maximum year')
    .option('--private', 'Create as private playlist');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();

    try {
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

      // Lazy-load SoundCloud client if not provided
      let clientToUse = soundcloudClient;
      if (!clientToUse) {
        spinner.text = 'Loading SoundCloud authentication from database...';
        try {
          // Load token from database
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
          clientToUse = new SoundCloudAPIClient(token);
          spinner.text = ''; // Clear the spinner text before continuing
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          throw new Error(
            `SoundCloud authentication failed: ${errorMsg}\n   Please run: npm run dev -- auth`
          );
        }
      }

      // Validate options
      const validated = Validator.validatePlaylistOptions(options);

      spinner.text = 'Checking SoundCloud rate limits...';
      const rateLimitService = new SoundCloudRateLimitService(db);
      await rateLimitService.initializeFromDatabase();

      const collectionService = new CollectionService(discogsClient, db);
      const playlistService = new PlaylistService(clientToUse, db, rateLimitService);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      let releases;

      // If release IDs are provided, use those specific releases
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
        ? chalk.yellow(`\n   ${unmatchedCounts.pending} track(s) could not be matched automatically — run:\n   npm run dev -- playlist review --title "${validated.title}"`)
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

      // Check for rate limit errors
      if (message.includes('rate limit')) {
        spinner.fail(
          chalk.red(`✗ SoundCloud rate limit exceeded.\n   ${message}\n   Please try again later.`)
        );
      } else {
        spinner.fail(CommandBuilder.formatError(`Failed to create playlist: ${message}`));
      }
      process.exit(1);
    }
  });

  // Register review and unmatched as subcommands of playlist
  cmd.addCommand(createReviewCommand(soundcloudClient, db));
  cmd.addCommand(createUnmatchedCommand(db));

  return cmd;
}
