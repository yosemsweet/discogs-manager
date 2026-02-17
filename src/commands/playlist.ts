import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { DatabaseManager } from '../services/database';
import { PlaylistService } from '../services/playlist';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { PlaylistFilter } from '../types';
import { ProgressInfo } from '../utils/progress';

export function createPlaylistCommand(
  discogsClient: DiscogsAPIClient,
  soundcloudClient: SoundCloudAPIClient,
  db: DatabaseManager
) {
  return new Command('playlist')
    .description('Create SoundCloud playlists from your collection')
    .option('-t, --title <title>', 'Playlist title')
    .option('-d, --description <description>', 'Playlist description')
    .option('-g, --genres <genres>', 'Comma-separated genres to include')
    .option('--min-year <year>', 'Minimum year')
    .option('--max-year <year>', 'Maximum year')
    .option('--private', 'Create as private playlist')
    .action(async (options) => {
      const spinner = ora().start();

      try {
        if (!options.title) {
          spinner.fail('Title is required');
          process.exit(1);
        }

        spinner.text = 'Checking SoundCloud rate limits...';
        const rateLimitService = new SoundCloudRateLimitService();

        const collectionService = new CollectionService(discogsClient, db);
        const playlistService = new PlaylistService(soundcloudClient, db, rateLimitService);

        const filter: PlaylistFilter = {
          genres: options.genres ? options.genres.split(',').map((g: string) => g.trim()) : undefined,
          minYear: options.minYear ? parseInt(options.minYear) : undefined,
          maxYear: options.maxYear ? parseInt(options.maxYear) : undefined,
        };

        // Create progress callback for filtering
        const filterProgressCallback = (progress: ProgressInfo) => {
          let message = `${progress.stage}`;
          if (progress.total > 0) {
            message += `: ${progress.current}/${progress.total}`;
          }
          if (progress.message) {
            message += ` - ${progress.message}`;
          }
          spinner.text = message;
        };

        const releases = await collectionService.filterReleases(filter, filterProgressCallback);

        if (releases.length === 0) {
          spinner.fail('No releases match the criteria');
          process.exit(1);
        }

        // Create progress callback for playlist creation
        const playlistProgressCallback = (progress: ProgressInfo) => {
          let message = `${progress.stage}`;
          if (progress.total > 0) {
            message += `: ${progress.current}/${progress.total}`;
          }
          if (progress.message) {
            message += ` - ${progress.message}`;
          }
          spinner.text = message;
        };

        const playlist = await playlistService.createPlaylist(
          options.title,
          releases,
          options.description,
          playlistProgressCallback
        );

        spinner.succeed(
          chalk.green(
            `✓ Playlist "${options.title}" created with ${releases.length} tracks`
          )
        );
        console.log(chalk.gray(`Playlist ID: ${playlist.id}`));
        process.exit(0);
      } catch (error) {
        // Check for rate limit errors
        if (error instanceof Error && error.message.includes('rate limit')) {
          spinner.fail(
            chalk.red(
              `✗ SoundCloud rate limit exceeded.\n` +
              `   ${error.message}\n` +
              `   Please try again later.`
            )
          );
        } else {
          spinner.fail(chalk.red(`✗ Failed to create playlist: ${error}`));
        }
        process.exit(1);
      }
    });
}
