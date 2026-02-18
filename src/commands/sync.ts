import { Command } from 'commander';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { CommandBuilder } from '../utils/command-builder';

export function createSyncCommand(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
  const cmd = new Command('sync')
    .description('Sync your Discogs collection to the local database')
    .option('-u, --username <username>', 'Discogs username')
    .option('-f, --force', 'Force refresh all releases from Discogs API')
    .option('--release-ids <ids>', 'Comma-separated Discogs release IDs (for testing/debugging)');

  // Use CommandBuilder for unified error handling
  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();

    try {
      const collectionService = new CollectionService(discogsClient, db);
      const username = options.username || process.env.DISCOGS_USERNAME;

      if (!username) {
        throw new Error('Username not provided. Use --username or set DISCOGS_USERNAME');
      }

      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      let count;
      if (options.releaseIds) {
        // Sync specific releases
        const releaseIds = options.releaseIds.split(',').map((id: string) => parseInt(id.trim()));
        count = await collectionService.syncSpecificReleases(username, releaseIds, progressCallback, options.force);
      } else {
        // Sync entire collection
        count = await collectionService.syncCollection(username, progressCallback, options.force);
      }

      spinner.succeed(CommandBuilder.formatSuccess(`Successfully synced ${count} releases`));
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(CommandBuilder.formatError(message));
      process.exit(1);
    }
  });

  return cmd;
}
