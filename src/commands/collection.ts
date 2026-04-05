import { Command } from 'commander';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';
import { createSyncCommand } from './sync';
import { createListCommand } from './list';
import { createStatsCommand } from './stats';
import { createRetryCommand } from './retry';

export function createCollectionCommand(
  discogsClient: DiscogsAPIClient,
  db: DatabaseManager
): Command {
  const cmd = new Command('collection')
    .description('Manage your Discogs collection')
    .action(() => { cmd.help(); });

  cmd.addCommand(createSyncCommand(discogsClient, db));
  cmd.addCommand(createListCommand(discogsClient, db));
  cmd.addCommand(createStatsCommand(discogsClient, db));
  cmd.addCommand(createRetryCommand(db));

  return cmd;
}
