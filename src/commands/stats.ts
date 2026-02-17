import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';

export function createStatsCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('stats')
    .description('Show collection statistics')
    .argument('[username]', 'Discogs username (optional, uses env if not provided)')
    .option('-v, --verbose', 'Show detailed stats including style breakdown')
    .action(async (username, options) => {
      const spinner = ora('Calculating statistics...').start();

      try {
        const usernameToUse = username || process.env.DISCOGS_USERNAME;
        if (!usernameToUse) {
          spinner.fail('Username not provided. Use argument or set DISCOGS_USERNAME');
          process.exit(1);
        }

        const collectionService = new CollectionService(discogsClient, db);
        
        spinner.text = 'Loading collection data...';
        const stats = await collectionService.getStats(options.verbose);

        spinner.succeed(chalk.green('✓ Statistics calculated'));

        console.log(chalk.bold('\n📊 Collection Statistics:\n'));
        console.log(chalk.cyan(`Total Releases: ${stats.totalReleases}`));
        console.log(chalk.cyan(`Total Genres: ${stats.totalGenres}`));
        console.log(
          chalk.cyan(
            `Year Range: ${stats.yearsSpan.min} - ${stats.yearsSpan.max}`
          )
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
        spinner.fail(chalk.red(`✗ Failed to get stats: ${error}`));
        process.exit(1);
      }
    });
}
