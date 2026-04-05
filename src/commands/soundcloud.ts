import { Command } from 'commander';
import { createAuthCommand } from './auth';

export function createSoundCloudCommand(): Command {
  const cmd = new Command('soundcloud')
    .description('Manage SoundCloud authentication')
    .action(() => { cmd.help(); });

  cmd.addCommand(createAuthCommand());

  return cmd;
}
