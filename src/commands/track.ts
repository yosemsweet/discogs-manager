import { Command } from 'commander';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { DatabaseManager } from '../services/database';
import { createLookupCommand } from './lookup';

export function createTrackCommand(
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
): Command {
  const cmd = new Command('track')
    .description('Look up track information')
    .action(() => { cmd.help(); });

  cmd.addCommand(createLookupCommand(soundcloudClient, db));

  return cmd;
}
