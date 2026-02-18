import { Command } from 'commander';
import chalk from 'chalk';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { DatabaseManager } from '../services/database';
import { PlaylistService } from '../services/playlist';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { PlaylistFilter } from '../types';
import { CommandBuilder } from '../utils/command-builder';

export function createPlaylistCommand(
  discogsClient: DiscogsAPIClient,
  soundcloudClient: SoundCloudAPIClient,
  db: DatabaseManager
) {
  const cmd = new Command('playlist')
    .description('Create SoundCloud playlists from your collection')
    .option('-t, --title <title>', 'Playlist title')
    .option('-d, --description <description>', 'Playlist description')
    .option('-g, --genres <genres>', 'Comma-separated genres to include')
    .option('--release-ids <ids>', 'Comma-separated Discogs release IDs (for testing)')
    .option('--min-year <year>', 'Minimum year')
    .option('--max-year <year>', 'Maximum year')
    .option('--private', 'Create as private playlist');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();

    try {
      if (!options.title) {
        throw new Error('Title is required');
      }

      spinner.text = 'Checking SoundCloud rate limits...';
      const rateLimitService = new SoundCloudRateLimitService(db);
      await rateLimitService.initializeFromDatabase();

      const collectionService = new CollectionService(discogsClient, db);
      const playlistService = new PlaylistService(soundcloudClient, db, rateLimitService);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      let releases;

      // If release IDs are provided, use those specific releases
      if (options.releaseIds) {
        spinner.text = 'Fetching specified releases...';
        const releaseIds = options.releaseIds.split(',').map((id: string) => parseInt(id.trim()));
        releases = await Promise.all(releaseIds.map((id: number) => db.getReleaseByDiscogsId(id)));
        releases = releases.filter((r) => r !== null);
      } else {
        const filter: PlaylistFilter = {
          genres: options.genres ? options.genres.split(',').map((g: string) => g.trim()) : undefined,
          minYear: options.minYear ? parseInt(options.minYear) : undefined,
          maxYear: options.maxYear ? parseInt(options.maxYear) : undefined,
        };

        releases = await collectionService.filterReleases(filter, progressCallback);
      }

      if (releases.length === 0) {
        throw new Error('No releases match the criteria');
      }

      const playlist = await playlistService.createPlaylist(
        options.title,
        releases,
        options.description,
        progressCallback
      );

      spinner.succeed(
        CommandBuilder.formatSuccess(
          `Playlist "${options.title}" created with ${releases.length} tracks`
        )
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

  return cmd;
}
