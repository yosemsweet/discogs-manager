import Database from 'better-sqlite3';
import path from 'path';
import { StoredRelease } from '../types';

export class DatabaseManager {
  private db: Database.Database;
  public initialized: Promise<void>;

  constructor(dbPath: string = './data/discogs-manager.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
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

        CREATE INDEX IF NOT EXISTS idx_releases_year ON releases(year);
        CREATE INDEX IF NOT EXISTS idx_releases_genres ON releases(genres);
        CREATE INDEX IF NOT EXISTS idx_retry_queue_username ON retry_queue(username);
        CREATE INDEX IF NOT EXISTS idx_dlq_username ON dlq(username);
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

  getAllReleases(): Promise<StoredRelease[]> {
    return Promise.resolve().then(() => {
      const stmt = this.db.prepare('SELECT * FROM releases ORDER BY addedAt DESC');
      return (stmt.all() as StoredRelease[]) || [];
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
        'INSERT INTO playlists (id, title, description) VALUES (?, ?, ?)'
      );
      stmt.run(playlistId, title, description || '');
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
