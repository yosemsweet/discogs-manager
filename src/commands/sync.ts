import { Command } from 'commander';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { CommandBuilder } from '../utils/command-builder';
import { Validator, ValidationError } from '../utils/validator';

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
      // Validate options
      const validated = Validator.validateSyncOptions(options);

      const collectionService = new CollectionService(discogsClient, db);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      let count;
      if (validated.releaseIds) {
        // Sync specific releases
        count = await collectionService.syncSpecificReleases(validated.username, validated.releaseIds, progressCallback, validated.force);
      } else {
        // Sync entire collection
        count = await collectionService.syncCollection(validated.username, progressCallback, validated.force);
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
