import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { ProgressInfo } from '../utils/progress';

export function createSyncCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('sync')
    .description('Sync your Discogs collection to the local database')
    .option('-u, --username <username>', 'Discogs username')
    .option('-f, --force', 'Force refresh all releases from Discogs API')
    .action(async (options) => {
      const spinner = ora().start();
      let lastMessage = '';

      try {
        const collectionService = new CollectionService(discogsClient, db);
        const username = options.username || process.env.DISCOGS_USERNAME;

        if (!username) {
          spinner.fail('Username not provided. Use --username or set DISCOGS_USERNAME');
          process.exit(1);
        }

        // Create progress callback that updates the spinner
        const progressCallback = (progress: ProgressInfo) => {
          let message = `${progress.stage}: ${progress.current}/${progress.total}`;
          
          if (progress.currentPage !== undefined && progress.totalPages !== undefined) {
            message += ` (page ${progress.currentPage}/${progress.totalPages})`;
          }
          
          if (progress.message) {
            message += ` - ${progress.message}`;
          }
          
          spinner.text = message;
          lastMessage = message;
        };

        const count = await collectionService.syncCollection(username, progressCallback, options.force);
        spinner.succeed(chalk.green(`✓ Successfully synced ${count} releases`));
        process.exit(0);
      } catch (error) {
        spinner.fail(chalk.red(`✗ Failed to sync: ${error}`));
        process.exit(1);
      }
    });
}
