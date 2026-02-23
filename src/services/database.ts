import Database from 'better-sqlite3';
import path from 'path';
import { StoredRelease } from '../types';
import { ErrorHandler, ErrorType } from '../utils/error-handler';

export class DatabaseManager {
  private db: Database.Database;
  public initialized: Promise<void>;

  constructor(dbPath: string = './data/discogs-manager.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialized = this.initializeDatabase();
  }

  private initializeDatabase(): Promise<void> {
    return Promise.resolve().then(() => {
      // Create tables using synchronous API
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS releases (
          id INTEGER PRIMARY KEY,
          discogsId INTEGER UNIQUE NOT NULL,
          title TEXT NOT NULL,
          artists TEXT NOT NULL,
          year INTEGER,
          genres TEXT,
          styles TEXT,
          condition TEXT,
          rating INTEGER,
          addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          releaseId INTEGER NOT NULL,
          title TEXT NOT NULL,
          artists TEXT,
          position TEXT,
          duration TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (releaseId) REFERENCES releases(discogsId),
          UNIQUE(releaseId, position)
        );

        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          soundcloudId TEXT UNIQUE,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS playlist_releases (
          playlistId TEXT NOT NULL,
          releaseId INTEGER NOT NULL,
          soundcloudTrackId TEXT,
          PRIMARY KEY (playlistId, releaseId),
          FOREIGN KEY (playlistId) REFERENCES playlists(id),
          FOREIGN KEY (releaseId) REFERENCES releases(discogsId)
        );

        CREATE TABLE IF NOT EXISTS retry_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          releaseId INTEGER NOT NULL,
          username TEXT NOT NULL,
          attemptCount INTEGER DEFAULT 1,
          lastError TEXT,
          lastAttemptAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS dlq (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          releaseId INTEGER NOT NULL,
          username TEXT NOT NULL,
          errorMessage TEXT,
          lastAttemptAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS soundcloud_rate_limit (
          id INTEGER PRIMARY KEY,
          remaining INTEGER DEFAULT 15000,
          resetTime DATETIME,
          maxRequests INTEGER DEFAULT 15000,
          lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS soundcloud_tokens (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          access_token_encrypted TEXT NOT NULL,
          access_token_iv TEXT NOT NULL,
          access_token_auth_tag TEXT NOT NULL,
          refresh_token_encrypted TEXT NOT NULL,
          refresh_token_iv TEXT NOT NULL,
          refresh_token_auth_tag TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS track_matches (
          discogsReleaseId INTEGER NOT NULL,
          discogsTrackTitle TEXT NOT NULL,
          soundcloudTrackId TEXT NOT NULL,
          confidence REAL NOT NULL,
          matchedTitle TEXT,
          matchedArtist TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (discogsReleaseId, discogsTrackTitle),
          FOREIGN KEY (discogsReleaseId) REFERENCES releases(discogsId)
        );

        CREATE INDEX IF NOT EXISTS idx_releases_year ON releases(year);
        CREATE INDEX IF NOT EXISTS idx_releases_genres ON releases(genres);
        CREATE INDEX IF NOT EXISTS idx_tracks_releaseId ON tracks(releaseId);
        CREATE INDEX IF NOT EXISTS idx_retry_queue_username ON retry_queue(username);
        CREATE INDEX IF NOT EXISTS idx_dlq_username ON dlq(username);
        CREATE INDEX IF NOT EXISTS idx_track_matches_release ON track_matches(discogsReleaseId);
      `);
    });
  }

  addRelease(release: StoredRelease): Promise<void> {
    return Promise.resolve().then(() => {
      const addedAtValue = release.addedAt instanceof Date
        ? release.addedAt.toISOString()
        : release.addedAt || new Date().toISOString();

      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO releases 
        (discogsId, title, artists, year, genres, styles, condition, rating, addedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      stmt.run(
        release.discogsId,
        release.title,
        release.artists,
        release.year,
        release.genres,
        release.styles,
        release.condition,
        release.rating,
        addedAtValue
      );
    });
  }

  releaseExists(discogsId: number): Promise<boolean> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare('SELECT 1 FROM releases WHERE discogsId = ? LIMIT 1');
      const result = stmt.get(discogsId);
      return !!result;
    });
  }

  getAllReleases(): Promise<StoredRelease[]> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare('SELECT * FROM releases ORDER BY addedAt DESC');
      return (stmt.all() as StoredRelease[]) || [];
    });
  }

  getReleaseByDiscogsId(discogsId: number): Promise<StoredRelease | null> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare('SELECT * FROM releases WHERE discogsId = ? LIMIT 1');
      return (stmt.get(discogsId) as StoredRelease) || null;
    });
  }

  getReleasesByGenre(genre: string): Promise<StoredRelease[]> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare('SELECT * FROM releases WHERE genres LIKE ? ORDER BY title');
      return (stmt.all(`%${genre}%`) as StoredRelease[]) || [];
    });
  }

  getReleasesByYear(minYear: number, maxYear: number): Promise<StoredRelease[]> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        'SELECT * FROM releases WHERE year BETWEEN ? AND ? ORDER BY year'
      );
      return (stmt.all(minYear, maxYear) as StoredRelease[]) || [];
    });
  }

  createPlaylist(playlistId: string, title: string, description?: string): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO playlists (id, title, description, soundcloudId) VALUES (?, ?, ?, ?)'
      );
      // Ensure playlistId is stored as string to preserve precision
      const playlistIdStr = String(playlistId);
      stmt.run(playlistIdStr, title, description || '', playlistIdStr);
    });
  }

  addReleaseToPlaylist(
    playlistId: string,
    releaseId: number,
    soundcloudTrackId?: string
  ): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO playlist_releases (playlistId, releaseId, soundcloudTrackId) VALUES (?, ?, ?)'
      );
      stmt.run(playlistId, releaseId, soundcloudTrackId || null);
    });
  }

  getPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT r.* FROM releases r
        INNER JOIN playlist_releases pr ON r.discogsId = pr.releaseId
        WHERE pr.playlistId = ?`
      );
      return (stmt.all(playlistId) as StoredRelease[]) || [];
    });
  }

  getPlaylistByTitle(title: string): Promise<{ id: string; soundcloudId: string; description?: string } | null> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT id, soundcloudId, description FROM playlists WHERE title = ? ORDER BY updatedAt DESC LIMIT 1`
      );
      const result = stmt.get(title) as any;
      if (result) {
        return {
          id: String(result.id),
          soundcloudId: String(result.soundcloudId),
          description: result.description,
        };
      }
      return null;
    });
  }

  getPlaylistTracks(playlistId: string): Promise<Array<{ soundcloudTrackId: string; releaseId: number }>> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT soundcloudTrackId, releaseId FROM playlist_releases WHERE playlistId = ?`
      );
      return (stmt.all(playlistId) as Array<{ soundcloudTrackId: string; releaseId: number }>) || [];
    });
  }

  addToRetryQueue(releaseId: number, username: string, error: string): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `INSERT INTO retry_queue (releaseId, username, attemptCount, lastError, lastAttemptAt)
         VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)`
      );
      stmt.run(releaseId, username, error);
    });
  }

  incrementRetryAttempt(releaseId: number, username: string, error: string): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `UPDATE retry_queue 
         SET attemptCount = attemptCount + 1, lastError = ?, lastAttemptAt = CURRENT_TIMESTAMP
         WHERE releaseId = ? AND username = ?`
      );
      stmt.run(error, releaseId, username);
    });
  }

  getRetryQueueItems(username: string): Promise<Array<{ releaseId: number; attemptCount: number }>> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT releaseId, attemptCount FROM retry_queue WHERE username = ? ORDER BY createdAt ASC`
      );
      return (stmt.all(username) as Array<{ releaseId: number; attemptCount: number }>) || [];
    });
  }

  removeFromRetryQueue(releaseId: number, username: string): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `DELETE FROM retry_queue WHERE releaseId = ? AND username = ?`
      );
      stmt.run(releaseId, username);
    });
  }

  moveToDLQ(releaseId: number, username: string, errorMessage: string): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `INSERT INTO dlq (releaseId, username, errorMessage, lastAttemptAt)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      );
      stmt.run(releaseId, username, errorMessage);
    });
  }

  getDLQRecords(username?: string): Promise<Array<{ releaseId: number; errorMessage: string; createdAt: string }>> {
    return Promise.resolve().then(() => {
      if (username) {
        const stmt = this.db.prepare(
          `SELECT releaseId, errorMessage, createdAt FROM dlq WHERE username = ? ORDER BY createdAt DESC`
        );
        return (stmt.all(username) as Array<{ releaseId: number; errorMessage: string; createdAt: string }>) || [];
      } else {
        const stmt = this.db.prepare(
          `SELECT releaseId, errorMessage, createdAt FROM dlq ORDER BY createdAt DESC`
        );
        return (stmt.all() as Array<{ releaseId: number; errorMessage: string; createdAt: string }>) || [];
      }
    });
  }

  saveRateLimitState(remaining: number, resetTime: Date, maxRequests: number = 15000): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO soundcloud_rate_limit (id, remaining, resetTime, maxRequests, lastUpdated)
         VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`
      );
      stmt.run(remaining, resetTime.toISOString(), maxRequests);
    });
  }

  getRateLimitState(): Promise<{ remaining: number; resetTime: Date; maxRequests: number } | null> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT remaining, resetTime, maxRequests FROM soundcloud_rate_limit WHERE id = 1`
      );
      const row = stmt.get() as { remaining: number; resetTime: string; maxRequests: number } | undefined;
      if (row) {
        return {
          remaining: row.remaining,
          resetTime: new Date(row.resetTime),
          maxRequests: row.maxRequests,
        };
      }
      return null;
    });
  }

  addTracks(releaseId: number, tracklist: Array<{ title: string; artists?: any; position?: string; duration?: string }>): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO tracks (releaseId, title, artists, position, duration)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const track of tracklist) {
        const artists = track.artists
          ? (Array.isArray(track.artists) ? track.artists.map((a: any) => a.name).join(', ') : track.artists)
          : '';
        stmt.run(releaseId, track.title, artists, track.position || '', track.duration || '');
      }
    });
  }

  getTracksForRelease(releaseId: number): Promise<Array<{ title: string; artists: string; position: string; duration: string }>> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT title, artists, position, duration FROM tracks WHERE releaseId = ? ORDER BY position`
      );
      const rows = stmt.all(releaseId) as Array<{ title: string; artists: string; position: string; duration: string }>;
      return rows || [];
    });
  }

  /**
   * Get cached track match from database
   *
   * @param releaseId - Discogs release ID
   * @param trackTitle - Track title to lookup
   * @returns Cached track match result or null if not found
   */
  getCachedTrackMatch(
    releaseId: number,
    trackTitle: string
  ): Promise<{ soundcloudTrackId: string; confidence: number; matchedTitle: string } | null> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `SELECT soundcloudTrackId, confidence, matchedTitle
         FROM track_matches
         WHERE discogsReleaseId = ? AND discogsTrackTitle = ?`
      );
      const result = stmt.get(releaseId, trackTitle) as any;

      return result
        ? {
            soundcloudTrackId: result.soundcloudTrackId,
            confidence: result.confidence,
            matchedTitle: result.matchedTitle,
          }
        : null;
    });
  }

  /**
   * Save track match to cache
   *
   * @param releaseId - Discogs release ID
   * @param trackTitle - Original track title from Discogs
   * @param soundcloudTrackId - Matched SoundCloud track ID
   * @param confidence - Match confidence score (0-1)
   * @param matchedTitle - Title of matched SoundCloud track
   * @param matchedArtist - Artist of matched SoundCloud track (optional)
   */
  saveCachedTrackMatch(
    releaseId: number,
    trackTitle: string,
    soundcloudTrackId: string,
    confidence: number,
    matchedTitle: string,
    matchedArtist?: string
  ): Promise<void> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO track_matches
         (discogsReleaseId, discogsTrackTitle, soundcloudTrackId, confidence, matchedTitle, matchedArtist)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      stmt.run(releaseId, trackTitle, soundcloudTrackId, confidence, matchedTitle, matchedArtist || null);
    });
  }

  /**
   * Clear all cached track matches (useful for testing or cache invalidation)
   */
  clearTrackMatchCache(): Promise<void> {
    return Promise.resolve().then(() => {
      this.db.prepare('DELETE FROM track_matches').run();
    });
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache size and average confidence
   */
  getTrackMatchCacheStats(): Promise<{ totalMatches: number; averageConfidence: number }> {
    return Promise.resolve().then(() => {
      const result = this.db.prepare(
        `SELECT COUNT(*) as count, AVG(confidence) as avgConfidence FROM track_matches`
      ).get() as any;

      return {
        totalMatches: result.count || 0,
        averageConfidence: result.avgConfidence || 0,
      };
    });
  }

  close(): Promise<void> {
    return Promise.resolve().then(() => {
      try {
        this.db.close();
      } catch (err) {
        // Ignore errors during close
      }
    });
  }
}
