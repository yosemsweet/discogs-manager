#!/usr/bin/env node

import dotenv from 'dotenv';
import { program } from 'commander';
import chalk from 'chalk';
import { DiscogsAPIClient } from './api/discogs';
import { SoundCloudAPIClient } from './api/soundcloud';
import { DatabaseManager } from './services/database';
import { createCollectionCommand } from './commands/collection';
import { createSoundCloudCommand } from './commands/soundcloud';
import { createPlaylistCommand } from './commands/playlist';
import { createTrackCommand } from './commands/track';

dotenv.config();

program
  .name('discogs-cli')
  .description('CLI for managing Discogs collections and creating SoundCloud playlists')
  .version('2.0.0')
  .enablePositionalOptions();

// Initialize clients and database
const discogsToken = process.env.DISCOGS_API_TOKEN;
const discogsUsername = process.env.DISCOGS_USERNAME;
const dbPath = process.env.DB_PATH || './data/discogs-manager.db';
const soundcloudAccessToken = process.env.SOUNDCLOUD_ACCESS_TOKEN;

if (!discogsToken || !discogsUsername) {
  console.error(
    chalk.red('Error: DISCOGS_API_TOKEN and DISCOGS_USERNAME environment variables are required')
  );
  console.log(chalk.yellow('Create a .env file with your credentials. See .env.example for reference.'));
  process.exit(1);
}

const discogsClient = new DiscogsAPIClient(discogsToken, discogsUsername);

let soundcloudClient: SoundCloudAPIClient | null = null;
if (soundcloudAccessToken) {
  soundcloudClient = new SoundCloudAPIClient(soundcloudAccessToken);
}

const db = new DatabaseManager(dbPath);

// Register commands
program.addCommand(createCollectionCommand(discogsClient, db));
program.addCommand(createSoundCloudCommand());
program.addCommand(createPlaylistCommand(discogsClient, soundcloudClient, db));
program.addCommand(createTrackCommand(soundcloudClient, db));

// "Did you mean?" hints for removed top-level commands
const movedCommands: Record<string, string> = {
  sync: 'collection sync',
  list: 'collection list',
  stats: 'collection stats',
  retry: 'collection retry',
  auth: 'soundcloud auth',
  lookup: 'track lookup',
};

program.on('command:*', (operands) => {
  const name = operands[0];
  const hint = movedCommands[name];
  if (hint) {
    console.error(chalk.red(`Unknown command '${name}'. Did you mean: ${hint}?`));
  } else {
    console.error(chalk.red(`Unknown command: ${name}`));
  }
  process.exit(1);
});

program.parse(process.argv);

// Note: Commands call process.exit() directly to avoid SQLite3 native module issues with Node.js 25
// This prevents NAPI crashes during connection cleanup
