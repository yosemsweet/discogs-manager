import { Command } from 'commander';
import chalk from 'chalk';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';

export function createListCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('list')
    .description('List releases from your collection')
    .option('-g, --genre <genre>', 'Filter by genre')
    .option('-y, --year <year>', 'Filter by year')
    .option('--limit <limit>', 'Limit results', '50')
    .action(async (options) => {
      try {
        const collectionService = new CollectionService(discogsClient, db);
        let releases = await collectionService.filterReleases({
          genres: options.genre ? [options.genre] : undefined,
          minYear: options.year ? parseInt(options.year) : undefined,
          maxYear: options.year ? parseInt(options.year) : undefined,
        });

        const limit = parseInt(options.limit);
        releases = releases.slice(0, limit);

        if (releases.length === 0) {
          console.log(chalk.yellow('No releases found matching criteria'));
          return;
        }

        console.log(
          chalk.bold(`\n${releases.length} Releases:\n`)
        );

        releases.forEach((r) => {
          console.log(chalk.cyan(r.title));
          console.log(chalk.gray(`  ${r.artists} (${r.year})`));
          console.log(chalk.gray(`  Genres: ${r.genres}`));
          console.log();
        });
        process.exit(0);
      } catch (error) {
        console.error(chalk.red(`Failed to list releases: ${error}`));
        process.exit(1);
      }
    });
}
