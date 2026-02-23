import { Command } from 'commander';
import chalk from 'chalk';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { CommandBuilder } from '../utils/command-builder';
import { Validator, ValidationError } from '../utils/validator';
import { InputSanitizer } from '../utils/sanitizer';
import { Logger } from '../utils/logger';

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
    .option('-a, --artists <artists>', 'Filter by artists (comma-separated)')
    .option('-l, --labels <labels>', 'Filter by labels (comma-separated)')
    .option('--limit <limit>', 'Limit number of results', '50');

  cmd.action(async (username, options) => {
    const spinner = CommandBuilder.createSpinner();

    try {
      // Sanitize input for security
      if (username) {
        const sanitized = InputSanitizer.normalizeString(username);
        if (!sanitized) {
          throw new ValidationError('username', 'Username sanitization failed');
        }
        username = sanitized;

        if (InputSanitizer.isSuspicious(username)) {
          Logger.warn('Suspicious username pattern detected', { username });
          throw new ValidationError('username', 'Username contains suspicious patterns');
        }
      }

      // Sanitize genre options
      if (options.genres) {
        const sanitized = InputSanitizer.sanitizeSearchQuery(options.genres);
        if (!sanitized) {
          throw new ValidationError('genres', 'Genres filter sanitization failed');
        }
        options.genres = sanitized;
      }

      // Sanitize style options
      if (options.styles) {
        const sanitized = InputSanitizer.sanitizeSearchQuery(options.styles);
        if (!sanitized) {
          throw new ValidationError('styles', 'Styles filter sanitization failed');
        }
        options.styles = sanitized;
      }

      // Sanitize artist options
      if (options.artists) {
        const sanitized = InputSanitizer.sanitizeSearchQuery(options.artists);
        if (!sanitized) {
          throw new ValidationError('artists', 'Artists filter sanitization failed');
        }
        options.artists = sanitized;
      }

      // Sanitize label options
      if (options.labels) {
        const sanitized = InputSanitizer.sanitizeSearchQuery(options.labels);
        if (!sanitized) {
          throw new ValidationError('labels', 'Labels filter sanitization failed');
        }
        options.labels = sanitized;
      }

      // Validate options
      const validated = Validator.validateListOptions({
        username: username,
        limit: options.limit,
        genres: options.genres,
        minYear: options.minYear,
        maxYear: options.maxYear,
        minRating: options.minRating,
        maxRating: options.maxRating,
        styles: options.styles,
        artists: options.artists,
        labels: options.labels,
      });

      const collectionService = new CollectionService(discogsClient, db);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      let releases = await collectionService.filterReleases(validated.filter, progressCallback);

      releases = releases.slice(0, validated.limit);

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
