import { Command } from 'commander';
import chalk from 'chalk';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { CommandBuilder } from '../utils/command-builder';

export function createListCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  const cmd = new Command('list')
    .description('List releases from your collection with optional filters')
    .argument('[username]', 'Discogs username (optional, uses env if not provided)')
    .option('-g, --genres <genres>', 'Filter by genres (comma-separated)')
    .option('--min-year <year>', 'Minimum release year')
    .option('--max-year <year>', 'Maximum release year')
    .option('--min-rating <rating>', 'Minimum rating (0-5)')
    .option('--max-rating <rating>', 'Maximum rating (0-5)')
    .option('-s, --styles <styles>', 'Filter by styles (comma-separated)')
    .option('--limit <limit>', 'Limit number of results', '50');

  cmd.action(async (username, options) => {
    const spinner = CommandBuilder.createSpinner();

    try {
      const usernameToUse = username || process.env.DISCOGS_USERNAME;
      if (!usernameToUse) {
        throw new Error('Username not provided. Use argument or set DISCOGS_USERNAME');
      }

      const collectionService = new CollectionService(discogsClient, db);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      // Build filter from options
      const filter: any = {};

      if (options.genres) {
        filter.genres = options.genres.split(',').map((g: string) => g.trim());
      }

      if (options.minYear) {
        filter.minYear = parseInt(options.minYear);
      }

      if (options.maxYear) {
        filter.maxYear = parseInt(options.maxYear);
      }

      if (options.minRating) {
        filter.minRating = parseFloat(options.minRating);
      }

      if (options.maxRating) {
        filter.maxRating = parseFloat(options.maxRating);
      }

      if (options.styles) {
        filter.styles = options.styles.split(',').map((s: string) => s.trim());
      }

      let releases = await collectionService.filterReleases(filter, progressCallback);

      const limit = parseInt(options.limit);
      releases = releases.slice(0, limit);

      if (releases.length === 0) {
        spinner.warn(CommandBuilder.formatWarning('No releases found matching criteria'));
        process.exit(0);
      }

      spinner.succeed(CommandBuilder.formatSuccess(`Found ${releases.length} releases`));

      console.log(chalk.bold(`\n${releases.length} Releases:\n`));

      releases.forEach((r) => {
        console.log(chalk.cyan(r.title));
        console.log(chalk.gray(`  ${r.artists} (${r.year})`));
        console.log(chalk.gray(`  Genres: ${r.genres}`));
        console.log();
      });
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(CommandBuilder.formatError(`Failed to list releases: ${message}`));
      process.exit(1);
    }
  });

  return cmd;
}
