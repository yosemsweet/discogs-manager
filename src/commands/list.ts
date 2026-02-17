import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { ProgressInfo } from '../utils/progress';

export function createListCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('list')
    .description('List releases from your collection with optional filters')
    .argument('[username]', 'Discogs username (optional, uses env if not provided)')
    .option('-g, --genres <genres>', 'Filter by genres (comma-separated)')
    .option('--min-year <year>', 'Minimum release year')
    .option('--max-year <year>', 'Maximum release year')
    .option('--min-rating <rating>', 'Minimum rating (0-5)')
    .option('--max-rating <rating>', 'Maximum rating (0-5)')
    .option('-s, --styles <styles>', 'Filter by styles (comma-separated)')
    .option('--limit <limit>', 'Limit number of results', '50')
    .action(async (username, options) => {
      const spinner = ora().start();

      try {
        const usernameToUse = username || process.env.DISCOGS_USERNAME;
        if (!usernameToUse) {
          spinner.fail('Username not provided. Use argument or set DISCOGS_USERNAME');
          process.exit(1);
        }

        const collectionService = new CollectionService(discogsClient, db);
        
        // Create progress callback that updates the spinner
        const progressCallback = (progress: ProgressInfo) => {
          let message = `${progress.stage}`;
          
          if (progress.total > 0) {
            message += `: ${progress.current}/${progress.total}`;
          }
          
          if (progress.message) {
            message += ` - ${progress.message}`;
          }
          
          spinner.text = message;
        };

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
          spinner.warn(chalk.yellow('No releases found matching criteria'));
          process.exit(0);
        }

        spinner.succeed(chalk.green(`✓ Found ${releases.length} releases`));

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
        spinner.fail(chalk.red(`✗ Failed to list releases: ${error}`));
        process.exit(1);
      }
    });
}
