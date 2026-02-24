import { DatabaseManager } from '../src/services/database';
import { StoredRelease } from '../src/types';

describe('DatabaseManager', () => {
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    // Use in-memory SQLite database for tests
    dbManager = new DatabaseManager(':memory:');
    // Wait for database initialization to complete
    await (dbManager as any).initialized;
  });

  afterEach(async () => {
    await dbManager.close();
  });

  describe('addRelease', () => {
    test('should add a release to the database', async () => {
      const release: StoredRelease = {
        discogsId: 123,
        title: 'Test Album',
        artists: 'Test Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        condition: 'Mint',
        rating: 5,
        addedAt: new Date(),
      };

      await dbManager.addRelease(release);
      const releases = await dbManager.getAllReleases();

      expect(releases).toHaveLength(1);
      expect(releases[0].title).toBe('Test Album');
      expect(releases[0].discogsId).toBe(123);
    });

    test('should replace an existing release', async () => {
      const release1: StoredRelease = {
        discogsId: 123,
        title: 'Original Title',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      const release2: StoredRelease = {
        discogsId: 123,
        title: 'Updated Title',
        artists: 'Artist',
        year: 2021,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await dbManager.addRelease(release1);
      await dbManager.addRelease(release2);
      const releases = await dbManager.getAllReleases();

      expect(releases).toHaveLength(1);
      expect(releases[0].title).toBe('Updated Title');
      expect(releases[0].year).toBe(2021);
    });
  });

  describe('getAllReleases', () => {
    test('should return empty array when no releases', async () => {
      const releases = await dbManager.getAllReleases();
      expect(releases).toHaveLength(0);
    });

    test('should return all releases ordered by addedAt descending', async () => {
      const now = new Date();
      const oneSecondAgo = new Date(now.getTime() - 1000);
      const release1: StoredRelease = {
        discogsId: 1,
        title: 'Album 1',
        artists: 'Artist 1',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: oneSecondAgo,
      };

      const release2: StoredRelease = {
        discogsId: 2,
        title: 'Album 2',
        artists: 'Artist 2',
        year: 2021,
        genres: 'Jazz',
        styles: 'Bebop',
        addedAt: now,
      };

      await dbManager.addRelease(release1);
      await dbManager.addRelease(release2);

      const releases = await dbManager.getAllReleases();

      expect(releases).toHaveLength(2);
      expect(releases[0].discogsId).toBe(2);
      expect(releases[1].discogsId).toBe(1);

      expect(releases).toHaveLength(2);
      expect(releases[0].discogsId).toBe(2);
      expect(releases[1].discogsId).toBe(1);
    });
  });

  describe('getReleasesByGenre', () => {
    test('should filter releases by genre', async () => {
      const release1: StoredRelease = {
        discogsId: 1,
        title: 'Rock Album',
        artists: 'Rock Band',
        year: 2020,
        genres: 'Rock, Indie',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      const release2: StoredRelease = {
        discogsId: 2,
        title: 'Jazz Album',
        artists: 'Jazz Trio',
        year: 2021,
        genres: 'Jazz, Blues',
        styles: 'Bebop',
        addedAt: new Date(),
      };

      await dbManager.addRelease(release1);
      await dbManager.addRelease(release2);

      const rockReleases = await dbManager.getReleasesByGenre('Rock');
      expect(rockReleases).toHaveLength(1);
      expect(rockReleases[0].title).toBe('Rock Album');

      const jazzReleases = await dbManager.getReleasesByGenre('Jazz');
      expect(jazzReleases).toHaveLength(1);
      expect(jazzReleases[0].title).toBe('Jazz Album');
    });

    test('should return empty array for non-existent genre', async () => {
      const release: StoredRelease = {
        discogsId: 1,
        title: 'Rock Album',
        artists: 'Rock Band',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await dbManager.addRelease(release);
      const releases = await dbManager.getReleasesByGenre('Nonexistent');

      expect(releases).toHaveLength(0);
    });
  });

  describe('getReleasesByYear', () => {
    test('should filter releases by year range', async () => {
      const releases: StoredRelease[] = [
        {
          discogsId: 1,
          title: 'Album 2019',
          artists: 'Artist 1',
          year: 2019,
          genres: 'Rock',
          styles: 'Alternative',
          addedAt: new Date(),
        },
        {
          discogsId: 2,
          title: 'Album 2020',
          artists: 'Artist 2',
          year: 2020,
          genres: 'Jazz',
          styles: 'Bebop',
          addedAt: new Date(),
        },
        {
          discogsId: 3,
          title: 'Album 2021',
          artists: 'Artist 3',
          year: 2021,
          genres: 'Blues',
          styles: 'Classic Blues',
          addedAt: new Date(),
        },
      ];

      for (const release of releases) {
        await dbManager.addRelease(release);
      }

      const filtered = await dbManager.getReleasesByYear(2020, 2021);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].year).toBe(2020);
      expect(filtered[1].year).toBe(2021);
    });
  });

  describe('Playlist operations', () => {
    test('should create a playlist', async () => {
      await dbManager.createPlaylist('playlist-1', 'My Playlist', 'A test playlist');

      const release: StoredRelease = {
        discogsId: 1,
        title: 'Album',
        artists: 'Artist',
        year: 2020,
        genres: 'Rock',
        styles: 'Alternative',
        addedAt: new Date(),
      };

      await dbManager.addRelease(release);
      await dbManager.addReleaseToPlaylist('playlist-1', 1, 'track-123');

      const playlistReleases = await dbManager.getPlaylistReleases('playlist-1');

      expect(playlistReleases).toHaveLength(1);
      expect(playlistReleases[0].title).toBe('Album');
    });

    test('should return empty array for non-existent playlist', async () => {
      const releases = await dbManager.getPlaylistReleases('nonexistent-playlist');
      expect(releases).toHaveLength(0);
    });
  });

  describe('unmatched_tracks CRUD', () => {
    const baseRelease = {
      discogsId: 999,
      title: 'Test Album',
      artists: 'Test Artist',
      year: 2020,
      genres: 'Rock',
      styles: 'Alternative',
      addedAt: new Date(),
    };

    beforeEach(async () => {
      await dbManager.addRelease(baseRelease);
    });

    test('saveUnmatchedTrack stores a pending record', async () => {
      await dbManager.saveUnmatchedTrack({
        playlistTitle: 'My Playlist',
        discogsReleaseId: 999,
        discogsTrackTitle: 'Test Track',
        discogsArtist: 'Test Artist',
        discogsDuration: '3:30',
        releaseTitle: 'Test Album',
        topCandidatesJson: JSON.stringify([{ id: '1', title: 'Close Match', confidence: 0.45 }]),
        strategiesTriedCount: 4,
      });

      const records = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      expect(records).toHaveLength(1);
      expect(records[0].discogsTrackTitle).toBe('Test Track');
      expect(records[0].status).toBe('pending');
      expect(records[0].discogsArtist).toBe('Test Artist');
      expect(records[0].strategiesTriedCount).toBe(4);
    });

    test('getUnmatchedTracks filters by status', async () => {
      await dbManager.saveUnmatchedTrack({
        playlistTitle: 'My Playlist',
        discogsReleaseId: 999,
        discogsTrackTitle: 'Track A',
        strategiesTriedCount: 3,
      });
      await dbManager.saveUnmatchedTrack({
        playlistTitle: 'My Playlist',
        discogsReleaseId: 999,
        discogsTrackTitle: 'Track B',
        strategiesTriedCount: 2,
      });

      const pending = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      expect(pending).toHaveLength(2);

      const resolved = await dbManager.getUnmatchedTracks('My Playlist', 'resolved');
      expect(resolved).toHaveLength(0);
    });

    test('resolveUnmatchedTrack marks record as resolved', async () => {
      await dbManager.saveUnmatchedTrack({
        playlistTitle: 'My Playlist',
        discogsReleaseId: 999,
        discogsTrackTitle: 'Resolve Me',
        strategiesTriedCount: 1,
      });

      const [record] = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      await dbManager.resolveUnmatchedTrack(record.id, 'sc-track-789');

      const pending = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      expect(pending).toHaveLength(0);

      const resolved = await dbManager.getUnmatchedTracks('My Playlist', 'resolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].resolvedTrackId).toBe('sc-track-789');
      expect(resolved[0].resolvedAt).not.toBeNull();
    });

    test('skipUnmatchedTrack marks record as skipped', async () => {
      await dbManager.saveUnmatchedTrack({
        playlistTitle: 'My Playlist',
        discogsReleaseId: 999,
        discogsTrackTitle: 'Skip Me',
        strategiesTriedCount: 4,
      });

      const [record] = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      await dbManager.skipUnmatchedTrack(record.id);

      const pending = await dbManager.getUnmatchedTracks('My Playlist', 'pending');
      expect(pending).toHaveLength(0);

      const skipped = await dbManager.getUnmatchedTracks('My Playlist', 'skipped');
      expect(skipped).toHaveLength(1);
    });

    test('countUnmatchedTracks returns correct counts across all statuses', async () => {
      await dbManager.saveUnmatchedTrack({ playlistTitle: 'P', discogsReleaseId: 999, discogsTrackTitle: 'T1' });
      await dbManager.saveUnmatchedTrack({ playlistTitle: 'P', discogsReleaseId: 999, discogsTrackTitle: 'T2' });
      await dbManager.saveUnmatchedTrack({ playlistTitle: 'P', discogsReleaseId: 999, discogsTrackTitle: 'T3' });

      const records = await dbManager.getUnmatchedTracks('P', 'pending');
      await dbManager.resolveUnmatchedTrack(records[0].id, 'sc-1');
      await dbManager.skipUnmatchedTrack(records[1].id);

      const counts = await dbManager.countUnmatchedTracks('P');
      expect(counts.pending).toBe(1);
      expect(counts.resolved).toBe(1);
      expect(counts.skipped).toBe(1);
    });

    test('getUnmatchedTracks is scoped to playlistTitle', async () => {
      await dbManager.saveUnmatchedTrack({ playlistTitle: 'Playlist A', discogsReleaseId: 999, discogsTrackTitle: 'Track X' });
      await dbManager.saveUnmatchedTrack({ playlistTitle: 'Playlist B', discogsReleaseId: 999, discogsTrackTitle: 'Track Y' });

      const forA = await dbManager.getUnmatchedTracks('Playlist A', 'pending');
      const forB = await dbManager.getUnmatchedTracks('Playlist B', 'pending');

      expect(forA).toHaveLength(1);
      expect(forA[0].discogsTrackTitle).toBe('Track X');
      expect(forB).toHaveLength(1);
      expect(forB[0].discogsTrackTitle).toBe('Track Y');
    });
  });
});
