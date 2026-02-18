import { Command } from 'commander';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { CollectionService } from '../services/collection';
import { Logger } from '../utils/logger';
import { CommandBuilder } from '../utils/command-builder';

export function registerRetryCommand(program: Command) {
  program
    .command('retry <username>')
    .description('Process retry queue and check DLQ for a user')
    .action(async (username: string) => {
      const token = process.env.DISCOGS_TOKEN;
      if (!token) {
        Logger.error('DISCOGS_TOKEN environment variable not set');
        process.exit(1);
      }

      const db = new DatabaseManager();
      await db.initialized;

      const spinner = CommandBuilder.createSpinner();

      try {
        spinner.text = 'Processing retry queue...';

        const discogsClient = new DiscogsAPIClient(token, username);
        const collectionService = new CollectionService(discogsClient, db);

        // Process retry queue
        const retryResult = await collectionService.processRetryQueue(username, (progress) => {
          if (progress.message) {
            spinner.text = `[${progress.current}/${progress.total}] ${progress.message}`;
          }
        });

        spinner.succeed(
          CommandBuilder.formatSuccess(
            `Retry queue processed: ${retryResult.successCount} succeeded, ${retryResult.failureCount} failed`
          )
        );

        // Check DLQ
        const dlqRecords = await db.getDLQRecords(username);
        if (dlqRecords.length > 0) {
          Logger.warn(`\nDead Letter Queue contains ${dlqRecords.length} records:`);
          dlqRecords.slice(0, 10).forEach((record) => {
            Logger.warn(
              `  Release ${record.releaseId}: ${record.errorMessage} (${new Date(record.createdAt).toLocaleString()})`
            );
          });
          if (dlqRecords.length > 10) {
            Logger.warn(`  ... and ${dlqRecords.length - 10} more`);
          }
        } else {
          Logger.info('Dead Letter Queue is empty');
        }
        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner.fail(CommandBuilder.formatError(`Failed to process retry: ${message}`));
        process.exit(1);
      } finally {
        await db.close();
      }
    });
}
