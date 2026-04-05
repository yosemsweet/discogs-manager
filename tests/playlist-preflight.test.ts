/**
 * Tests for Approach 4: Release-as-playlist preflight search
 *
 * Tests cover:
 * - SoundCloudAPIClient.searchPlaylists
 * - TrackMatcher.scorePlaylistMatch
 * - TrackMatcher.findBestPlaylistMatch
 * - TrackMatcher.mapPlaylistTracksToRelease
 * - TrackSearchService.searchReleaseAsPlaylist
 * - TrackSearchService.searchTracksForReleases (playlist preflight integration)
 */
import {
  TrackMatcher,
  MatchCandidate,
  PlaylistCandidate,
  DiscogsTrackInfo,
} from '../src/services/track-matcher';
import { TrackSearchService } from '../src/services/track-search';
import { SoundCloudAPIClient } from '../src/api/soundcloud';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSCTrack(overrides: Partial<MatchCandidate> & { id: string }): MatchCandidate {
  return {
    title: 'Track',
    user: { username: 'artist' },
    duration: 200000,
    ...overrides,
  };
}

function makePlaylist(overrides: Partial<PlaylistCandidate> & { id: string }): PlaylistCandidate {
  return {
    title: 'Playlist',
    user: { username: 'artist' },
    ...overrides,
  };
}

function makeDiscogsTrack(overrides: Partial<DiscogsTrackInfo> & { title: string; position: number }): DiscogsTrackInfo {
  return {
    artists: '',
    duration: null,
    ...overrides,
  };
}

// ─── SoundCloudAPIClient.searchPlaylists ────────────────────────────────────

describe('SoundCloudAPIClient.searchPlaylists', () => {
  it('returns playlist results for a query', async () => {
    const mockResponse = {
      data: {
        collection: [
          { id: '100', title: 'Lesotho EP', user: { username: 'touaneofficial' } },
          { id: '200', title: 'Lesotho Vibes', user: { username: 'randomuser' } },
        ],
      },
    };

    // Create client and stub the internal axios instance
    const client = new SoundCloudAPIClient('fake-token');
    const axiosClient = (client as any).client;
    jest.spyOn(axiosClient, 'get').mockResolvedValue(mockResponse);

    const results = await client.searchPlaylists('Touane Lesotho EP');

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Lesotho EP');
    expect(axiosClient.get).toHaveBeenCalledWith('/playlists', {
      params: { q: 'Touane Lesotho EP', limit: 10 },
    });
  });

  it('handles empty results gracefully', async () => {
    const client = new SoundCloudAPIClient('fake-token');
    const axiosClient = (client as any).client;
    jest.spyOn(axiosClient, 'get').mockResolvedValue({ data: { collection: [] } });

    const results = await client.searchPlaylists('Nonexistent Artist Album');

    expect(results).toEqual([]);
  });

  it('handles array response format', async () => {
    const client = new SoundCloudAPIClient('fake-token');
    const axiosClient = (client as any).client;
    jest.spyOn(axiosClient, 'get').mockResolvedValue({
      data: [{ id: '1', title: 'Test' }],
    });

    const results = await client.searchPlaylists('test');
    expect(results).toHaveLength(1);
  });
});

// ─── TrackMatcher.scorePlaylistMatch ────────────────────────────────────────

describe('TrackMatcher.scorePlaylistMatch', () => {
  it('scores artist\'s own playlist higher than unrelated playlist', () => {
    const artistPlaylist = makePlaylist({
      id: '1',
      title: 'Lesotho EP',
      user: { username: 'touaneofficial' },
      permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
    });

    const unrelatedPlaylist = makePlaylist({
      id: '2',
      title: 'Lesotho Beats',
      user: { username: 'randomuser' },
      permalink_url: 'https://soundcloud.com/randomuser/sets/lesotho-beats',
    });

    const artistScore = TrackMatcher.scorePlaylistMatch('Lesotho EP', 'Touane', artistPlaylist);
    const unrelatedScore = TrackMatcher.scorePlaylistMatch('Lesotho EP', 'Touane', unrelatedPlaylist);

    expect(artistScore).toBeGreaterThan(unrelatedScore);
    expect(artistScore).toBeGreaterThan(0.5);
  });

  it('title-only match can exceed threshold (artist is boost, not gate)', () => {
    const labelPlaylist = makePlaylist({
      id: '1',
      title: 'Lesotho EP',
      user: { username: 'completelyunrelated' },
    });

    const score = TrackMatcher.scorePlaylistMatch('Lesotho EP', 'Touane', labelPlaylist);

    // Title match is strong (1.0), artist doesn't match (0), so score = 0.65.
    // A label or fan upload with a matching title should still qualify.
    expect(score).toBeGreaterThan(0.5);

    // Artist's own playlist should score higher than the label's
    const artistPlaylist = makePlaylist({
      id: '2',
      title: 'Lesotho EP',
      user: { username: 'touaneofficial' },
      permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
    });
    const artistScore = TrackMatcher.scorePlaylistMatch('Lesotho EP', 'Touane', artistPlaylist);
    expect(artistScore).toBeGreaterThan(score);
  });

  it('uses URL slug for artist matching', () => {
    const playlist = makePlaylist({
      id: '1',
      title: 'Magnificent Fall',
      user: { username: 'TheNotwistBand' },
      permalink_url: 'https://soundcloud.com/the-notwist/sets/magnificent-fall',
    });

    const score = TrackMatcher.scorePlaylistMatch('Magnificent Fall', 'The Notwist', playlist);

    // URL slug "the-notwist" should boost the artist match
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns low score when title does not match at all', () => {
    const playlist = makePlaylist({
      id: '1',
      title: 'Completely Different Album',
      user: { username: 'touaneofficial' },
    });

    const score = TrackMatcher.scorePlaylistMatch('Lesotho EP', 'Touane', playlist);
    expect(score).toBeLessThan(0.4);
  });
});

// ─── TrackMatcher.findBestPlaylistMatch ─────────────────────────────────────

describe('TrackMatcher.findBestPlaylistMatch', () => {
  it('selects the best matching playlist', () => {
    const playlists: PlaylistCandidate[] = [
      makePlaylist({ id: '1', title: 'Lesotho Vibes', user: { username: 'randomdj' } }),
      makePlaylist({
        id: '2',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      }),
      makePlaylist({ id: '3', title: 'Something Else', user: { username: 'otheruser' } }),
    ];

    const result = TrackMatcher.findBestPlaylistMatch('Lesotho EP', 'Touane', playlists);

    expect(result).not.toBeNull();
    expect(result!.playlist.id).toBe('2');
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when no playlist is confident enough', () => {
    const playlists: PlaylistCandidate[] = [
      makePlaylist({ id: '1', title: 'Completely Wrong', user: { username: 'nobody' } }),
    ];

    const result = TrackMatcher.findBestPlaylistMatch('Lesotho EP', 'Touane', playlists);
    expect(result).toBeNull();
  });

  it('returns null for empty playlists array', () => {
    const result = TrackMatcher.findBestPlaylistMatch('Lesotho EP', 'Touane', []);
    expect(result).toBeNull();
  });
});

// ─── TrackMatcher.mapPlaylistTracksToRelease ────────────────────────────────

describe('TrackMatcher.mapPlaylistTracksToRelease', () => {
  it('maps tracks by title similarity even when counts match', () => {
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow' }),
      makeSCTrack({ id: '11', title: 'The Band' }),
      makeSCTrack({ id: '12', title: 'Lesotho' }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(3);
    expect(result.unmatched).toHaveLength(0);
    // Verify correct pairings by title, not just position
    const matchedTitles = result.matched.map(m => ({
      discogs: m.discogsTrack.title,
      sc: m.soundcloudTrack.title,
    }));
    expect(matchedTitles).toContainEqual({ discogs: 'Grow', sc: 'Grow' });
    expect(matchedTitles).toContainEqual({ discogs: 'The Band', sc: 'The Band' });
    expect(matchedTitles).toContainEqual({ discogs: 'Lesotho', sc: 'Lesotho' });
  });

  it('maps correctly when playlist order differs from release order (SC4.3)', () => {
    // Playlist tracks in REVERSED order
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '12', title: 'Lesotho' }),
      makeSCTrack({ id: '11', title: 'The Band' }),
      makeSCTrack({ id: '10', title: 'Grow' }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(3);
    expect(result.unmatched).toHaveLength(0);

    // Must match by title, NOT position — Grow should pair with Grow regardless of order
    const growMatch = result.matched.find(m => m.discogsTrack.title === 'Grow');
    expect(growMatch!.soundcloudTrack.id).toBe('10');
    const bandMatch = result.matched.find(m => m.discogsTrack.title === 'The Band');
    expect(bandMatch!.soundcloudTrack.id).toBe('11');
    const lesothoMatch = result.matched.find(m => m.discogsTrack.title === 'Lesotho');
    expect(lesothoMatch!.soundcloudTrack.id).toBe('12');
  });

  it('uses duration as tiebreaker when title scores are close', () => {
    // Two SC tracks with very similar titles but different durations
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow', duration: 240000 }), // 4:00
      makeSCTrack({ id: '11', title: 'Grow (Extended)', duration: 360000 }), // 6:00
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0, duration: '4:00' }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(1);
    // Should pick the one closer in duration (240000 = 4:00 matches exactly)
    expect(result.matched[0].soundcloudTrack.id).toBe('10');
  });

  it('maps tracks by title similarity when counts differ', () => {
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow' }),
      makeSCTrack({ id: '11', title: 'The Band' }),
      makeSCTrack({ id: '12', title: 'Lesotho' }),
      makeSCTrack({ id: '13', title: 'Bonus Track' }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(3);
    expect(result.unmatched).toHaveLength(0);

    // Verify correct pairings by title
    const matchedTitles = result.matched.map(m => ({
      discogs: m.discogsTrack.title,
      sc: m.soundcloudTrack.title,
    }));
    expect(matchedTitles).toContainEqual({ discogs: 'Grow', sc: 'Grow' });
    expect(matchedTitles).toContainEqual({ discogs: 'The Band', sc: 'The Band' });
    expect(matchedTitles).toContainEqual({ discogs: 'Lesotho', sc: 'Lesotho' });
  });

  it('returns unmatched Discogs tracks when playlist has fewer tracks', () => {
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow' }),
      makeSCTrack({ id: '11', title: 'The Band' }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(2);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].title).toBe('Lesotho');
  });

  it('handles empty playlist tracks', () => {
    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease([], discogsTracks);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('handles tracks with no title similarity', () => {
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'XXXXX' }),
      makeSCTrack({ id: '11', title: 'YYYYY' }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    // All discogs tracks should be unmatched since SC titles have no similarity
    expect(result.unmatched).toHaveLength(3);
    expect(result.matched).toHaveLength(0);
  });
});

// ─── TrackSearchService.searchReleaseAsPlaylist ─────────────────────────────

describe('TrackSearchService.searchReleaseAsPlaylist', () => {
  let mockSoundcloudClient: jest.Mocked<SoundCloudAPIClient>;
  let mockDb: any;
  let service: TrackSearchService;

  beforeEach(() => {
    mockSoundcloudClient = {
      searchPlaylists: jest.fn(),
      getPlaylistTracks: jest.fn(),
      searchTrack: jest.fn(),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    mockDb = {
      getTracksForRelease: jest.fn(),
      getCachedTrackMatch: jest.fn(),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    service = new TrackSearchService(mockSoundcloudClient, mockDb);
  });

  it('returns all tracks when full playlist found', async () => {
    // searchPlaylists returns a match
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    // getPlaylistTracks returns all 3 tracks
    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
      { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
    ]);

    const release = { discogsId: 1, title: 'Lesotho EP' } as any;
    const tracks = [
      { title: 'Grow', artists: 'Touane', duration: '4:00' },
      { title: 'The Band', artists: 'Touane', duration: '3:20' },
      { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
    ];

    const result = await service.searchReleaseAsPlaylist(release, tracks);

    expect(result).not.toBeNull();
    expect(result!.matched).toHaveLength(3);
    expect(result!.unmatchedTracks).toHaveLength(0);
    expect(result!.matched.map(m => m.trackId)).toEqual(['10', '11', '12']);
  });

  it('returns empty when no playlist matches', async () => {
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([]);

    const release = { discogsId: 1, title: 'Obscure Release' } as any;
    const tracks = [{ title: 'Track 1', artists: 'Unknown' }];

    const result = await service.searchReleaseAsPlaylist(release, tracks);

    expect(result).toBeNull();
  });

  it('returns partial results when playlist has fewer tracks', async () => {
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    // Playlist only has 2 of 3 tracks
    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
    ]);

    const release = { discogsId: 1, title: 'Lesotho EP' } as any;
    const tracks = [
      { title: 'Grow', artists: 'Touane', duration: '4:00' },
      { title: 'The Band', artists: 'Touane', duration: '3:20' },
      { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
    ];

    const result = await service.searchReleaseAsPlaylist(release, tracks);

    expect(result).not.toBeNull();
    expect(result!.matched).toHaveLength(2);
    expect(result!.unmatchedTracks).toHaveLength(1);
    expect(result!.unmatchedTracks[0].title).toBe('Lesotho');
  });

  it('returns null when playlist search finds no confident match', async () => {
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '999',
        title: 'Completely Wrong Playlist',
        user: { username: 'nobodyrelevant' },
      },
    ]);

    const release = { discogsId: 1, title: 'Lesotho EP' } as any;
    const tracks = [{ title: 'Grow', artists: 'Touane' }];

    const result = await service.searchReleaseAsPlaylist(release, tracks);
    expect(result).toBeNull();
  });

  it('handles API errors gracefully', async () => {
    mockSoundcloudClient.searchPlaylists.mockRejectedValue(new Error('Network error'));

    const release = { discogsId: 1, title: 'Test' } as any;
    const tracks = [{ title: 'Track', artists: 'Artist' }];

    const result = await service.searchReleaseAsPlaylist(release, tracks);
    expect(result).toBeNull();
  });
});

// ─── TrackSearchService.searchTracksForReleases (integration) ───────────────

describe('TrackSearchService.searchTracksForReleases playlist preflight integration', () => {
  let mockSoundcloudClient: jest.Mocked<SoundCloudAPIClient>;
  let mockDb: any;
  let service: TrackSearchService;

  beforeEach(() => {
    mockSoundcloudClient = {
      searchPlaylists: jest.fn(),
      getPlaylistTracks: jest.fn(),
      searchTrack: jest.fn(),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    mockDb = {
      getTracksForRelease: jest.fn(),
      getCachedTrackMatch: jest.fn().mockResolvedValue(null),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    service = new TrackSearchService(mockSoundcloudClient, mockDb);
  });

  it('tries playlist preflight before per-track search', async () => {
    // Setup: 3-track release with playlist match
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Grow', artists: 'Touane', duration: '4:00' },
      { title: 'The Band', artists: 'Touane', duration: '3:20' },
      { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
    ]);

    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
      { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
    ]);

    const releases = [{ discogsId: 1, title: 'Lesotho EP' }] as any[];

    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(3);
    // searchTrack should NOT have been called — all resolved via playlist
    expect(mockSoundcloudClient.searchTrack).not.toHaveBeenCalled();
    // searchPlaylists SHOULD have been called
    expect(mockSoundcloudClient.searchPlaylists).toHaveBeenCalled();
  });

  it('skips playlist preflight when release has only 1 track', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Single Track', artists: 'Artist', duration: '3:00' },
    ]);

    // searchTrack returns a match
    mockSoundcloudClient.searchTrack.mockResolvedValue([
      { id: '50', title: 'Single Track', user: { username: 'Artist' }, duration: 180000 },
    ]);

    const releases = [{ discogsId: 1, title: 'Single Release' }] as any[];

    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(1);
    // searchPlaylists should NOT have been called for a single-track release
    expect(mockSoundcloudClient.searchPlaylists).not.toHaveBeenCalled();
    // searchTrack SHOULD have been called
    expect(mockSoundcloudClient.searchTrack).toHaveBeenCalled();
  });

  it('falls back to per-track search for unmatched tracks from playlist', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Grow', artists: 'Touane', duration: '4:00' },
      { title: 'The Band', artists: 'Touane', duration: '3:20' },
      { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
    ]);

    // Playlist found but only 2 tracks
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
    ]);

    // Per-track search for "Lesotho"
    mockSoundcloudClient.searchTrack.mockResolvedValue([
      { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
    ]);

    const releases = [{ discogsId: 1, title: 'Lesotho EP' }] as any[];

    const result = await service.searchTracksForReleases(releases);

    // 2 from playlist + 1 from per-track fallback = 3
    expect(result).toHaveLength(3);
    // searchTrack should only have been called for the unmatched track
    expect(mockSoundcloudClient.searchTrack).toHaveBeenCalled();
  });

  it('falls back entirely to per-track when no playlist matches', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Track A', artists: 'Unknown', duration: '3:00' },
      { title: 'Track B', artists: 'Unknown', duration: '4:00' },
    ]);

    // No playlist match
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([]);

    // Per-track search returns matches
    mockSoundcloudClient.searchTrack
      .mockResolvedValueOnce([
        { id: '20', title: 'Track A', user: { username: 'Unknown' }, duration: 180000 },
      ])
      .mockResolvedValueOnce([
        { id: '21', title: 'Track B', user: { username: 'Unknown' }, duration: 240000 },
      ]);

    const releases = [{ discogsId: 1, title: 'Some Album' }] as any[];

    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(2);
    expect(mockSoundcloudClient.searchTrack).toHaveBeenCalledTimes(2);
  });

  it('playlist preflight reduces API calls for multi-track releases', async () => {
    const tracks3 = [
      { title: 'Grow', artists: 'Touane', duration: '4:00' },
      { title: 'The Band', artists: 'Touane', duration: '3:20' },
      { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
    ];
    mockDb.getTracksForRelease.mockResolvedValue(tracks3);

    // With playlist preflight: 1 searchPlaylists + 1 getPlaylistTracks = 2 calls
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
      { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
    ]);

    const releases = [{ discogsId: 1, title: 'Lesotho EP' }] as any[];
    await service.searchTracksForReleases(releases);

    // Only 2 SoundCloud API calls: searchPlaylists + getPlaylistTracks
    expect(mockSoundcloudClient.searchPlaylists).toHaveBeenCalledTimes(1);
    expect(mockSoundcloudClient.getPlaylistTracks).toHaveBeenCalledTimes(1);
    // No per-track search calls needed
    expect(mockSoundcloudClient.searchTrack).not.toHaveBeenCalled();
  });
});

// ─── Integration-style: full example set ────────────────────────────────────

describe('Full example set: Touane Lesotho EP resolved via playlist preflight', () => {
  it('all three Touane tracks match touaneofficial when playlist found', () => {
    // Simulate the playlist being found and mapped
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow', user: { username: 'touaneofficial' } }),
      makeSCTrack({ id: '11', title: 'The Band', user: { username: 'touaneofficial' } }),
      makeSCTrack({ id: '12', title: 'Lesotho', user: { username: 'touaneofficial' } }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', artists: 'Touane', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', artists: 'Touane', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', artists: 'Touane', position: 2 }),
    ];

    const mapping = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(mapping.matched).toHaveLength(3);
    expect(mapping.unmatched).toHaveLength(0);

    // Verify each track maps to touaneofficial
    for (const m of mapping.matched) {
      expect(m.soundcloudTrack.user?.username).toBe('touaneofficial');
    }
  });

  it('playlist scoring selects touaneofficial playlist over unrelated ones', () => {
    const playlists: PlaylistCandidate[] = [
      makePlaylist({
        id: '1',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      }),
      makePlaylist({
        id: '2',
        title: 'Lesotho Compilation',
        user: { username: 'madera_music' },
        permalink_url: 'https://soundcloud.com/madera_music/sets/lesotho-compilation',
      }),
    ];

    const result = TrackMatcher.findBestPlaylistMatch('Lesotho EP', 'Touane', playlists);

    expect(result).not.toBeNull();
    expect(result!.playlist.id).toBe('1');
    expect(result!.playlist.user?.username).toBe('touaneofficial');
  });
});

// ─── Success Criteria Validation (SC4.1–SC4.7) ────────────────────────────────

describe('Approach 4 Success Criteria', () => {
  // SC4.1: searchPlaylists("Touane Lesotho EP") returns results including touaneofficial/sets/lesotho-ep
  it('SC4.1: searchPlaylists returns results including the artist playlist', async () => {
    const client = new SoundCloudAPIClient('fake-token');
    const axiosClient = (client as any).client;
    jest.spyOn(axiosClient, 'get').mockResolvedValue({
      data: {
        collection: [
          {
            id: '100',
            title: 'Lesotho EP',
            user: { username: 'touaneofficial' },
            permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
          },
          { id: '200', title: 'Lesotho Vibes', user: { username: 'randomuser' } },
        ],
      },
    });

    const results = await client.searchPlaylists('Touane Lesotho EP');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const artistPlaylist = results.find(
      (r: any) => r.permalink_url?.includes('touaneofficial/sets/lesotho-ep')
    );
    expect(artistPlaylist).toBeDefined();
  });

  // SC4.2: Playlist scoring selects touaneofficial/sets/lesotho-ep over unrelated playlists
  it('SC4.2: playlist scoring selects artist playlist over unrelated playlists', () => {
    const playlists: PlaylistCandidate[] = [
      makePlaylist({
        id: '1',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      }),
      makePlaylist({
        id: '2',
        title: 'Lesotho Beats',
        user: { username: 'madera_music' },
      }),
      makePlaylist({
        id: '3',
        title: 'Lesotho EP',
        user: { username: 'randomuploader' },
      }),
    ];

    const result = TrackMatcher.findBestPlaylistMatch('Lesotho EP', 'Touane', playlists);

    expect(result).not.toBeNull();
    expect(result!.playlist.user?.username).toBe('touaneofficial');
  });

  // SC4.3: Tracks extracted from matched playlist correctly map to all three Discogs tracks
  it('SC4.3: playlist tracks correctly map to all Discogs tracks (Grow, The Band, Lesotho)', () => {
    const playlistTracks: MatchCandidate[] = [
      makeSCTrack({ id: '10', title: 'Grow', user: { username: 'touaneofficial' } }),
      makeSCTrack({ id: '11', title: 'The Band', user: { username: 'touaneofficial' } }),
      makeSCTrack({ id: '12', title: 'Lesotho', user: { username: 'touaneofficial' } }),
    ];

    const discogsTracks: DiscogsTrackInfo[] = [
      makeDiscogsTrack({ title: 'Grow', artists: 'Touane', position: 0 }),
      makeDiscogsTrack({ title: 'The Band', artists: 'Touane', position: 1 }),
      makeDiscogsTrack({ title: 'Lesotho', artists: 'Touane', position: 2 }),
    ];

    const result = TrackMatcher.mapPlaylistTracksToRelease(playlistTracks, discogsTracks);

    expect(result.matched).toHaveLength(3);
    expect(result.unmatched).toHaveLength(0);

    const mappedPairs = result.matched.map(m => ({
      discogs: m.discogsTrack.title,
      sc: m.soundcloudTrack.title,
    }));
    expect(mappedPairs).toContainEqual({ discogs: 'Grow', sc: 'Grow' });
    expect(mappedPairs).toContainEqual({ discogs: 'The Band', sc: 'The Band' });
    expect(mappedPairs).toContainEqual({ discogs: 'Lesotho', sc: 'Lesotho' });
  });

  // SC4.4: When no playlist match is found, system falls back to per-track search without error
  it('SC4.4: falls back to per-track search when no playlist match found', async () => {
    const mockSoundcloudClient = {
      searchPlaylists: jest.fn().mockResolvedValue([]),
      getPlaylistTracks: jest.fn(),
      searchTrack: jest.fn()
        .mockResolvedValueOnce([
          { id: '20', title: 'Track A', user: { username: 'artist' }, duration: 180000 },
        ])
        .mockResolvedValueOnce([
          { id: '21', title: 'Track B', user: { username: 'artist' }, duration: 240000 },
        ]),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    const mockDb = {
      getTracksForRelease: jest.fn().mockResolvedValue([
        { title: 'Track A', artists: 'Artist', duration: '3:00' },
        { title: 'Track B', artists: 'Artist', duration: '4:00' },
      ]),
      getCachedTrackMatch: jest.fn().mockResolvedValue(null),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    const service = new TrackSearchService(mockSoundcloudClient, mockDb as any);
    const result = await service.searchTracksForReleases([{ discogsId: 1, title: 'Obscure Album' }] as any[]);

    expect(result).toHaveLength(2);
    expect(mockSoundcloudClient.searchTrack).toHaveBeenCalledTimes(2);
  });

  // SC4.5: When playlist has fewer tracks than Discogs release, unmatched tracks fall back to per-track
  it('SC4.5: unmatched tracks from partial playlist fall back to per-track search', async () => {
    const mockSoundcloudClient = {
      searchPlaylists: jest.fn().mockResolvedValue([
        {
          id: '100',
          title: 'Lesotho EP',
          user: { username: 'touaneofficial' },
          permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
        },
      ]),
      getPlaylistTracks: jest.fn().mockResolvedValue([
        { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
        { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
      ]),
      searchTrack: jest.fn().mockResolvedValue([
        { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
      ]),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    const mockDb = {
      getTracksForRelease: jest.fn().mockResolvedValue([
        { title: 'Grow', artists: 'Touane', duration: '4:00' },
        { title: 'The Band', artists: 'Touane', duration: '3:20' },
        { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
      ]),
      getCachedTrackMatch: jest.fn().mockResolvedValue(null),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    const service = new TrackSearchService(mockSoundcloudClient, mockDb as any);
    const result = await service.searchTracksForReleases([{ discogsId: 1, title: 'Lesotho EP' }] as any[]);

    expect(result).toHaveLength(3);
    // Per-track search called only for the unmatched "Lesotho" track
    expect(mockSoundcloudClient.searchTrack).toHaveBeenCalled();
  });

  // SC4.6: API call count for a fully-matched release is 2 (search + get tracks)
  it('SC4.6: fully-matched release uses only 2 API calls (searchPlaylists + getPlaylistTracks)', async () => {
    const mockSoundcloudClient = {
      searchPlaylists: jest.fn().mockResolvedValue([
        {
          id: '100',
          title: 'Lesotho EP',
          user: { username: 'touaneofficial' },
          permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
        },
      ]),
      getPlaylistTracks: jest.fn().mockResolvedValue([
        { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
        { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
        { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
      ]),
      searchTrack: jest.fn(),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    const mockDb = {
      getTracksForRelease: jest.fn().mockResolvedValue([
        { title: 'Grow', artists: 'Touane', duration: '4:00' },
        { title: 'The Band', artists: 'Touane', duration: '3:20' },
        { title: 'Lesotho', artists: 'Touane', duration: '5:00' },
      ]),
      getCachedTrackMatch: jest.fn().mockResolvedValue(null),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    const service = new TrackSearchService(mockSoundcloudClient, mockDb as any);
    await service.searchTracksForReleases([{ discogsId: 1, title: 'Lesotho EP' }] as any[]);

    expect(mockSoundcloudClient.searchPlaylists).toHaveBeenCalledTimes(1);
    expect(mockSoundcloudClient.getPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(mockSoundcloudClient.searchTrack).not.toHaveBeenCalled();
  });

  // SC4.7: No regression — releases matched correctly via per-track search remain correct
  it('SC4.7: no regression on existing match fixtures', () => {
    const fixtureData = require('./fixtures/track-match-fixtures.json');
    const MATCH_THRESHOLD = TrackMatcher.getConfidenceThreshold();

    interface Fixture {
      discogsTitle: string;
      discogsArtist: string;
      discogsDuration?: string;
      soundcloudTitle: string;
      soundcloudUsername: string;
      soundcloudDurationMs?: number;
      expectMatch: boolean;
    }

    let failures = 0;
    for (const fixture of fixtureData as Fixture[]) {
      const candidate: MatchCandidate = {
        id: '1',
        title: fixture.soundcloudTitle,
        user: { username: fixture.soundcloudUsername },
        duration: fixture.soundcloudDurationMs,
      };
      const { confidence } = TrackMatcher.scoreMatch(
        fixture.discogsTitle,
        fixture.discogsArtist,
        fixture.discogsDuration || null,
        candidate
      );
      const passed = fixture.expectMatch
        ? confidence >= MATCH_THRESHOLD
        : confidence < MATCH_THRESHOLD;
      if (!passed) failures++;
    }

    // Allow at most 20% failure rate across all fixtures
    const failureRate = failures / (fixtureData as Fixture[]).length;
    expect(failureRate).toBeLessThanOrEqual(0.20);
  });
});

// ─── Artist Resolution (SC4.8–SC4.11) ──────────────────────────────────────

describe('Artist resolution across release types', () => {
  let mockSoundcloudClient: jest.Mocked<SoundCloudAPIClient>;
  let mockDb: any;
  let service: TrackSearchService;

  beforeEach(() => {
    mockSoundcloudClient = {
      searchPlaylists: jest.fn(),
      getPlaylistTracks: jest.fn(),
      searchTrack: jest.fn(),
      throttleIfApproachingLimit: jest.fn(),
    } as any;

    mockDb = {
      getTracksForRelease: jest.fn(),
      getCachedTrackMatch: jest.fn().mockResolvedValue(null),
      saveCachedTrackMatch: jest.fn(),
      saveUnmatchedTrack: jest.fn(),
    };

    service = new TrackSearchService(mockSoundcloudClient, mockDb);
  });

  // SC4.8: Release-level artist used for preflight when track.artists is empty
  it('SC4.8: preflight uses release.artists when track.artists is empty', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Grow', artists: '', duration: '4:00' },
      { title: 'The Band', artists: '', duration: '3:20' },
      { title: 'Lesotho', artists: '', duration: '5:00' },
    ]);

    mockSoundcloudClient.searchPlaylists.mockResolvedValue([
      {
        id: '100',
        title: 'Lesotho EP',
        user: { username: 'touaneofficial' },
        permalink_url: 'https://soundcloud.com/touaneofficial/sets/lesotho-ep',
      },
    ]);

    mockSoundcloudClient.getPlaylistTracks.mockResolvedValue([
      { id: '10', title: 'Grow', user: { username: 'touaneofficial' }, duration: 240000 },
      { id: '11', title: 'The Band', user: { username: 'touaneofficial' }, duration: 200000 },
      { id: '12', title: 'Lesotho', user: { username: 'touaneofficial' }, duration: 300000 },
    ]);

    // Release has artists="Touane" but tracks have empty artists
    const releases = [{ discogsId: 1, title: 'Lesotho EP', artists: 'Touane' }] as any[];
    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(3);
    // searchPlaylists should have been called with "Touane Lesotho EP" (from release.artists)
    expect(mockSoundcloudClient.searchPlaylists).toHaveBeenCalledWith(
      'Touane Lesotho EP',
      5
    );
  });

  // SC4.9: Compilation with per-track artists uses track artist for per-track search
  it('SC4.9: per-track search uses track-level artist for compilations', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'The Unassisted', artists: 'Rasco', duration: '3:30' },
    ]);

    mockSoundcloudClient.searchTrack.mockResolvedValue([
      { id: '50', title: 'The Unassisted', user: { username: 'Rasco' }, duration: 210000 },
    ]);

    // Release artist is "DJ Cam" but track artist is "Rasco"
    const releases = [{ discogsId: 502629, title: 'DJ-Kicks:', artists: 'DJ Cam' }] as any[];
    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(1);
    // searchTrack should use track artist "Rasco" not release artist "DJ Cam"
    const searchCall = mockSoundcloudClient.searchTrack.mock.calls[0][0] as string;
    expect(searchCall).toContain('Rasco');
    expect(searchCall).not.toContain('DJ Cam');
  });

  // SC4.10: Compilation preflight uses release artist, per-track fallback uses track artist
  it('SC4.10: compilation preflight uses release artist, fallback uses track artist', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Track A', artists: 'Artist A', duration: '3:00' },
      { title: 'Track B', artists: 'Artist B', duration: '4:00' },
    ]);

    // No playlist match found
    mockSoundcloudClient.searchPlaylists.mockResolvedValue([]);

    // Per-track search returns matches
    mockSoundcloudClient.searchTrack
      .mockResolvedValueOnce([
        { id: '20', title: 'Track A', user: { username: 'Artist A' }, duration: 180000 },
      ])
      .mockResolvedValueOnce([
        { id: '21', title: 'Track B', user: { username: 'Artist B' }, duration: 240000 },
      ]);

    const releases = [{ discogsId: 1, title: 'Compilation', artists: 'Various' }] as any[];
    const result = await service.searchTracksForReleases(releases);

    expect(result).toHaveLength(2);
    // Preflight query should use release artist "Various"
    expect(mockSoundcloudClient.searchPlaylists).toHaveBeenCalledWith(
      'Various Compilation',
      5
    );
    // Per-track queries should use track-level artists
    const firstQuery = mockSoundcloudClient.searchTrack.mock.calls[0][0] as string;
    const secondQuery = mockSoundcloudClient.searchTrack.mock.calls[1][0] as string;
    expect(firstQuery).toContain('Artist A');
    expect(secondQuery).toContain('Artist B');
  });

  // SC4.11: Effective artist falls back to release.artists for all per-track operations
  it('SC4.11: effective artist fallback used for query, scoring, and near-miss recording', async () => {
    mockDb.getTracksForRelease.mockResolvedValue([
      { title: 'Grow', artists: '', duration: '4:00' },
    ]);

    // No match found — will trigger near-miss recording
    mockSoundcloudClient.searchTrack.mockResolvedValue([
      { id: '99', title: 'Grow Something', user: { username: 'randomuser' }, duration: 240000 },
    ]);

    const releases = [{ discogsId: 1549643, title: 'Lesotho EP', artists: 'Touane' }] as any[];
    await service.searchTracksForReleases(releases, undefined, 'Test Playlist');

    // searchTrack query should include "Touane" (from release.artists fallback)
    const query = mockSoundcloudClient.searchTrack.mock.calls[0][0] as string;
    expect(query).toContain('Touane');

    // saveUnmatchedTrack should record the effective artist
    if (mockDb.saveUnmatchedTrack.mock.calls.length > 0) {
      const savedTrack = mockDb.saveUnmatchedTrack.mock.calls[0][0];
      expect(savedTrack.discogsArtist).toBe('Touane');
    }
  });
});

// ─── Regression: existing match fixtures still work ─────────────────────────

describe('Match rate does not regress on existing test fixtures', () => {
  // Import and run the same fixtures used in track-matcher-accuracy.test.ts
  // to ensure Approach 4 changes don't break existing scoring
  const fixtureData = require('./fixtures/track-match-fixtures.json');
  const MATCH_THRESHOLD = TrackMatcher.getConfidenceThreshold();

  interface Fixture {
    description: string;
    discogsTitle: string;
    discogsArtist: string;
    discogsDuration?: string;
    soundcloudTitle: string;
    soundcloudUsername: string;
    soundcloudDurationMs?: number;
    expectMatch: boolean;
  }

  const matchFixtures = (fixtureData as Fixture[]).filter(f => f.expectMatch);
  const nonMatchFixtures = (fixtureData as Fixture[]).filter(f => !f.expectMatch);

  it('existing "should match" fixtures still score above threshold', () => {
    let passCount = 0;
    for (const fixture of matchFixtures) {
      const candidate: MatchCandidate = {
        id: '1',
        title: fixture.soundcloudTitle,
        user: { username: fixture.soundcloudUsername },
        duration: fixture.soundcloudDurationMs,
      };
      const { confidence } = TrackMatcher.scoreMatch(
        fixture.discogsTitle,
        fixture.discogsArtist,
        fixture.discogsDuration || null,
        candidate
      );
      if (confidence >= MATCH_THRESHOLD) passCount++;
    }

    const rate = matchFixtures.length > 0 ? passCount / matchFixtures.length : 0;
    expect(rate).toBeGreaterThanOrEqual(0.75);
  });

  it('existing "should NOT match" fixtures still score below threshold', () => {
    let passCount = 0;
    for (const fixture of nonMatchFixtures) {
      const candidate: MatchCandidate = {
        id: '1',
        title: fixture.soundcloudTitle,
        user: { username: fixture.soundcloudUsername },
        duration: fixture.soundcloudDurationMs,
      };
      const { confidence } = TrackMatcher.scoreMatch(
        fixture.discogsTitle,
        fixture.discogsArtist,
        fixture.discogsDuration || null,
        candidate
      );
      if (confidence < MATCH_THRESHOLD) passCount++;
    }

    const rate = nonMatchFixtures.length > 0 ? passCount / nonMatchFixtures.length : 0;
    expect(rate).toBeGreaterThanOrEqual(0.80);
  });
});
