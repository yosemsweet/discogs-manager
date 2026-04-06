import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { SoundCloudAPIClient } from '../src/api/soundcloud';
import { SoundCloudOAuthService } from '../src/services/soundcloud-oauth';

jest.mock('../src/services/soundcloud-oauth');

describe('SoundCloudAPIClient — token refresh on 401', () => {
  const INITIAL_TOKEN = 'initial-token';
  const REFRESHED_TOKEN = 'refreshed-token';

  let mockOAuthService: jest.Mocked<SoundCloudOAuthService>;
  let axiosMock: MockAdapter;

  beforeEach(() => {
    mockOAuthService = new (SoundCloudOAuthService as any)() as jest.Mocked<SoundCloudOAuthService>;
    mockOAuthService.getValidAccessToken = jest.fn().mockResolvedValue(REFRESHED_TOKEN);
  });

  afterEach(() => {
    if (axiosMock) axiosMock.restore();
  });

  test('successful request does not call getValidAccessToken', async () => {
    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);
    axiosMock.onGet('/me/playlists').reply(200, []);

    await client.getUserPlaylists();

    expect(mockOAuthService.getValidAccessToken).not.toHaveBeenCalled();
  });

  test('401 with oauthService triggers refresh and retries exactly once', async () => {
    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);

    // First call returns 401, retry returns 200
    axiosMock
      .onGet('/me/playlists')
      .replyOnce(401)
      .onGet('/me/playlists')
      .replyOnce(200, []);

    await client.getUserPlaylists();

    expect(mockOAuthService.getValidAccessToken).toHaveBeenCalledTimes(1);
  });

  test('after successful retry, subsequent requests use the refreshed token', async () => {
    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);

    axiosMock
      .onGet('/me/playlists')
      .replyOnce(401)
      .onGet('/me/playlists')
      .reply(200, []);

    await client.getUserPlaylists();
    await client.getUserPlaylists();

    // accessToken on the instance should be the refreshed one
    expect((client as any).accessToken).toBe(REFRESHED_TOKEN);
    // Axios default header should also be updated
    expect((client as any).client.defaults.headers['Authorization']).toBe(`OAuth ${REFRESHED_TOKEN}`);
  });

  test('second consecutive 401 (retry also fails) propagates as error — no infinite loop', async () => {
    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);
    axiosMock.onGet('/me/playlists').reply(401);

    await expect(client.getUserPlaylists()).rejects.toBeDefined();
    // Only one refresh attempt
    expect(mockOAuthService.getValidAccessToken).toHaveBeenCalledTimes(1);
  });

  test('without oauthService, 401 throws immediately without refresh', async () => {
    const client = new SoundCloudAPIClient(INITIAL_TOKEN);
    axiosMock = new MockAdapter((client as any).client);
    axiosMock.onGet('/me/playlists').reply(401);

    await expect(client.getUserPlaylists()).rejects.toBeDefined();
    expect(mockOAuthService.getValidAccessToken).not.toHaveBeenCalled();
  });

  test('concurrent 401s share a single refresh call — serialization guard', async () => {
    // Make getValidAccessToken slow so concurrent calls can queue up
    let resolveRefresh: (v: string) => void;
    const refreshPromise = new Promise<string>(res => { resolveRefresh = res; });
    mockOAuthService.getValidAccessToken = jest.fn().mockReturnValueOnce(refreshPromise);

    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);

    // Both initial and retry calls return 200 after refresh
    axiosMock.onGet('/me/playlists').replyOnce(401).onGet('/me/playlists').reply(200, []);
    axiosMock.onGet('/playlists').replyOnce(401).onGet('/playlists').reply(200, { collection: [] });

    // Fire two concurrent 401-triggering requests
    const p1 = client.getUserPlaylists();
    const p2 = client.searchPlaylists('test');

    // Resolve the slow refresh
    resolveRefresh!(REFRESHED_TOKEN);

    await Promise.all([p1, p2]);

    // Only one refresh call despite two concurrent 401s
    expect(mockOAuthService.getValidAccessToken).toHaveBeenCalledTimes(1);
  });

  test('if getValidAccessToken throws, the error propagates clearly', async () => {
    mockOAuthService.getValidAccessToken = jest.fn().mockRejectedValue(new Error('Refresh token revoked'));

    const client = new SoundCloudAPIClient(INITIAL_TOKEN, undefined, mockOAuthService);
    axiosMock = new MockAdapter((client as any).client);
    axiosMock.onGet('/me/playlists').reply(401);

    await expect(client.getUserPlaylists()).rejects.toThrow('Refresh token revoked');
  });

  test('existing tests: constructing with only a token string still works', async () => {
    const client = new SoundCloudAPIClient('some-token');
    expect((client as any).accessToken).toBe('some-token');
    expect((client as any).oauthService).toBeNull();
  });

  test('constructor throws when no token is given', () => {
    expect(() => new SoundCloudAPIClient('')).toThrow();
  });
});
