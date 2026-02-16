import sqlite3 from 'sqlite3';
import path from 'path';
import { StoredRelease } from '../types';

export class DatabaseManager {
  private db: sqlite3.Database;

  constructor(dbPath: string = './data/discogs-manager.db') {
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      }
    });
    this.initializeDatabase();
  }

  private initializeDatabase() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS releases (
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
      )`,
      `CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        soundcloudId TEXT UNIQUE,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS playlist_releases (
        playlistId TEXT NOT NULL,
        releaseId INTEGER NOT NULL,
        soundcloudTrackId TEXT,
        PRIMARY KEY (playlistId, releaseId),
        FOREIGN KEY (playlistId) REFERENCES playlists(id),
        FOREIGN KEY (releaseId) REFERENCES releases(discogsId)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_releases_year ON releases(year)`,
      `CREATE INDEX IF NOT EXISTS idx_releases_genres ON releases(genres)`,
    ];

    queries.forEach((query) => {
      this.db.run(query, (err) => {
        if (err) {
          console.error('Error creating table:', err);
        }
      });
    });
  }

  addRelease(release: StoredRelease): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO releases 
        (discogsId, title, artists, year, genres, styles, condition, rating)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
      stmt.finalize();
    });
  }

  getAllReleases(): Promise<StoredRelease[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM releases ORDER BY addedAt DESC', (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []) as StoredRelease[]);
      });
    });
  }

  getReleasesByGenre(genre: string): Promise<StoredRelease[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM releases WHERE genres LIKE ? ORDER BY title', [`%${genre}%`], (err: Error | null, rows: StoredRelease[]) => {
        if (err) reject(err);
        else resolve((rows || []) as StoredRelease[]);
      });
    });
  }

  getReleasesByYear(minYear: number, maxYear: number): Promise<StoredRelease[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM releases WHERE year BETWEEN ? AND ? ORDER BY year',
        [minYear, maxYear],
        (err: Error | null, rows: StoredRelease[]) => {
          if (err) reject(err);
          else resolve((rows || []) as StoredRelease[]);
        }
      );
    });
  }

  createPlaylist(playlistId: string, title: string, description?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO playlists (id, title, description) VALUES (?, ?, ?)`,
        [playlistId, title, description || ''],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  addReleaseToPlaylist(playlistId: string, releaseId: number, soundcloudTrackId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO playlist_releases (playlistId, releaseId, soundcloudTrackId) VALUES (?, ?, ?)`,
        [playlistId, releaseId, soundcloudTrackId || null],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getPlaylistReleases(playlistId: string): Promise<StoredRelease[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT r.* FROM releases r
        INNER JOIN playlist_releases pr ON r.discogsId = pr.releaseId
        WHERE pr.playlistId = ?`,
        [playlistId],
        (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []) as StoredRelease[]);
        }
      );
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
