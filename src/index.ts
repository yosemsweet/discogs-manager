#!/usr/bin/env node

import dotenv from 'dotenv';
import { program } from 'commander';
import chalk from 'chalk';
import { DiscogsAPIClient } from './api/discogs';
import { SoundCloudAPIClient } from './api/soundcloud';
import { DatabaseManager } from './services/database';
import { createSyncCommand } from './commands/sync';
import { createListCommand } from './commands/list';
import { createStatsCommand } from './commands/stats';
import { createPlaylistCommand } from './commands/playlist';

dotenv.config();

program
  .name('discogs-cli')
  .description('CLI for managing Discogs collections and creating SoundCloud playlists')
  .version('1.0.0');

// Initialize clients and database
const discogsToken = process.env.DISCOGS_API_TOKEN;
const discogsUsername = process.env.DISCOGS_USERNAME;
const soundcloudClientId = process.env.SOUNDCLOUD_CLIENT_ID;
const soundcloudUserToken = process.env.SOUNDCLOUD_USER_TOKEN;
const dbPath = process.env.DB_PATH || './data/discogs-manager.db';

if (!discogsToken || !discogsUsername) {
  console.error(
    chalk.red('Error: DISCOGS_API_TOKEN and DISCOGS_USERNAME environment variables are required')
  );
  console.log(chalk.yellow('Create a .env file with your credentials. See .env.example for reference.'));
  process.exit(1);
}

const discogsClient = new DiscogsAPIClient(discogsToken, discogsUsername);
const soundcloudClient = new SoundCloudAPIClient(
  soundcloudClientId || '',
  soundcloudUserToken || ''
);
const db = new DatabaseManager(dbPath);

// Register commands
program.addCommand(createSyncCommand(discogsClient, db));
program.addCommand(createListCommand(discogsClient, db));
program.addCommand(createStatsCommand(discogsClient, db));
program.addCommand(
  createPlaylistCommand(discogsClient, soundcloudClient, db)
);

program.parse(process.argv);

// Note: Commands call process.exit() directly to avoid SQLite3 native module issues with Node.js 25
// This prevents NAPI crashes during connection cleanup
