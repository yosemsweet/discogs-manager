import { Command } from 'commander';
import chalk from 'chalk';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';
import { CommandBuilder } from '../utils/command-builder';
import { Validator, ValidationError } from '../utils/validator';

export function createStatsCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  const cmd = new Command('stats')
    .description('Show collection statistics')
    .option('-u, --username <username>', 'Discogs username (uses DISCOGS_USERNAME env if not provided)')
    .option('-v, --verbose', 'Show detailed stats including style breakdown');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();
    spinner.text = 'Calculating statistics...';

    try {
      const username = options.username || process.env.DISCOGS_USERNAME;

      // Validate options
      const validated = Validator.validateStatsOptions({
        username,
      });

      const collectionService = new CollectionService(discogsClient, db);

      spinner.text = 'Loading collection data...';
      const stats = await collectionService.getStats(options.verbose);

      spinner.succeed(CommandBuilder.formatSuccess('Statistics calculated'));

      console.log(chalk.bold('\n📊 Collection Statistics:\n'));
      console.log(chalk.cyan(`Total Releases: ${stats.totalReleases}`));
      console.log(chalk.cyan(`Total Genres: ${stats.totalGenres}`));
      console.log(
        chalk.cyan(`Year Range: ${stats.yearsSpan.min} - ${stats.yearsSpan.max}`)
      );

      console.log(chalk.bold('\nTop Genres:'));
      const genreEntries = Array.from(stats.genreStats.entries()) as [string, number][];
      for (let i = 0; i < Math.min(10, genreEntries.length); i++) {
        const [genre, count] = genreEntries[i];
        console.log(chalk.gray(`  • ${genre}: ${count} release${count !== 1 ? 's' : ''}`));
      }

      if (options.verbose && stats.styleStats) {
        console.log(chalk.bold('\nTop Styles:'));
        const styleEntries = Array.from(stats.styleStats.entries()) as [string, number][];
        for (let i = 0; i < Math.min(10, styleEntries.length); i++) {
          const [style, count] = styleEntries[i];
          console.log(chalk.gray(`  • ${style}: ${count} release${count !== 1 ? 's' : ''}`));
        }
      }

      console.log();
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(CommandBuilder.formatError(`Failed to get stats: ${message}`));
      process.exit(1);
    }
  });

  return cmd;
}
