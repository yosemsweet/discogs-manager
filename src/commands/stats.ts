import { Command } from 'commander';
import chalk from 'chalk';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { DiscogsAPIClient } from '../api/discogs';

export function createStatsCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('stats')
    .description('Show collection statistics')
    .action(async () => {
      try {
        const collectionService = new CollectionService(discogsClient, db);
        const stats = await collectionService.getStats();

        console.log(chalk.bold('\n📊 Collection Statistics:\n'));
        console.log(chalk.cyan(`Total Releases: ${stats.totalReleases}`));
        console.log(chalk.cyan(`Total Genres: ${stats.totalGenres}`));
        console.log(
          chalk.cyan(
            `Year Range: ${stats.yearsSpan.min} - ${stats.yearsSpan.max}`
          )
        );
        console.log(chalk.bold('\nTop Genres:'));
        stats.genres.slice(0, 10).forEach((g) => {
          console.log(chalk.gray(`  • ${g}`));
        });
        console.log();
      } catch (error) {
        console.error(chalk.red(`Failed to get stats: ${error}`));
        process.exit(1);
      }
    });
}
