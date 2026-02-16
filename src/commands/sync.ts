import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';

export function createSyncCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  return new Command('sync')
    .description('Sync your Discogs collection to the local database')
    .option('-u, --username <username>', 'Discogs username')
    .action(async (options) => {
      const spinner = ora('Syncing collection...').start();

      try {
        const collectionService = new CollectionService(discogsClient, db);
        const username = options.username || process.env.DISCOGS_USERNAME;

        if (!username) {
          spinner.fail('Username not provided. Use --username or set DISCOGS_USERNAME');
          process.exit(1);
        }

        const count = await collectionService.syncCollection(username);
        spinner.succeed(chalk.green(`Successfully synced ${count} releases`));
        process.exit(0);
      } catch (error) {
        spinner.fail(chalk.red(`Failed to sync: ${error}`));
        process.exit(1);
      }
    });
}
