import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { DatabaseManager } from '../services/database';
import { PlaylistService } from '../services/playlist';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { PlaylistFilter } from '../types';

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
      const spinner = ora('Creating playlist...').start();

      try {
        if (!options.title) {
          spinner.fail('Title is required');
          process.exit(1);
        }

        const collectionService = new CollectionService(discogsClient, db);
        const playlistService = new PlaylistService(soundcloudClient, db);

        const filter: PlaylistFilter = {
          genres: options.genres ? options.genres.split(',').map((g: string) => g.trim()) : undefined,
          minYear: options.minYear ? parseInt(options.minYear) : undefined,
          maxYear: options.maxYear ? parseInt(options.maxYear) : undefined,
        };

        const releases = await collectionService.filterReleases(filter);

        if (releases.length === 0) {
          spinner.fail('No releases match the criteria');
          process.exit(1);
        }

        const playlist = await playlistService.createPlaylist(
          options.title,
          releases,
          options.description
        );

        spinner.succeed(
          chalk.green(
            `Playlist "${options.title}" created with ${releases.length} tracks`
          )
        );
        console.log(chalk.gray(`Playlist ID: ${playlist.id}`));
      } catch (error) {
        spinner.fail(chalk.red(`Failed to create playlist: ${error}`));
        process.exit(1);
      }
    });
}
