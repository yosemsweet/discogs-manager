import { createSoundCloudCommand } from '../src/commands/soundcloud';

jest.mock('chalk', () => ({
  __esModule: true,
  default: { green: (s: string) => s, red: (s: string) => s, cyan: (s: string) => s, yellow: (s: string) => s, gray: (s: string) => s, bold: (s: string) => s },
}));
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: jest.fn().mockReturnThis(), succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(), text: '' }),
}));

// Auth command uses these — mock to avoid real OAuth calls
jest.mock('open', () => jest.fn());
jest.mock('express', () => {
  const app = { use: jest.fn(), get: jest.fn(), listen: jest.fn(() => ({ close: jest.fn() })) };
  return jest.fn(() => app);
});

describe('createSoundCloudCommand', () => {
  test('soundcloud command is registered with name "soundcloud"', () => {
    const cmd = createSoundCloudCommand();
    expect(cmd.name()).toBe('soundcloud');
  });

  test('soundcloud has auth subcommand', () => {
    const cmd = createSoundCloudCommand();
    expect(cmd.commands.map(c => c.name())).toContain('auth');
  });

  test('soundcloud auth subcommand is named "auth"', () => {
    const cmd = createSoundCloudCommand();
    const auth = cmd.commands.find(c => c.name() === 'auth');
    expect(auth).toBeDefined();
  });

  test('soundcloud has a description', () => {
    const cmd = createSoundCloudCommand();
    expect(cmd.description()).toBeTruthy();
  });
});
