import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from './database';
import { DiscogsRelease, PlaylistFilter, StoredRelease } from '../types';

export class CollectionService {
  private discogsClient: DiscogsAPIClient;
  private db: DatabaseManager;

  constructor(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
    this.discogsClient = discogsClient;
    this.db = db;
  }

  async syncCollection(username: string) {
    try {
      const collection = await this.discogsClient.getCollectionPaginated(username);
      const releases = collection.releases || [];

      let processedCount = 0;
      for (const release of releases) {
        const releaseDetails = await this.discogsClient.getRelease(release.id);
        const storedRelease: StoredRelease = {
          discogsId: releaseDetails.id,
          title: releaseDetails.title,
          artists: releaseDetails.artists
            .map((a: any) => a.name)
            .join(', '),
          year: releaseDetails.year,
          genres: releaseDetails.genres.join(', '),
          styles: releaseDetails.styles.join(', '),
          addedAt: new Date(),
        };
        await this.db.addRelease(storedRelease);
        processedCount++;
      }

      return processedCount;
    } catch (error) {
      throw new Error(`Failed to sync collection: ${error}`);
    }
  }

  async filterReleases(filter: PlaylistFilter): Promise<StoredRelease[]> {
    let releases = await this.db.getAllReleases();

    if (filter.genres && filter.genres.length > 0) {
      releases = releases.filter((r) =>
        filter.genres!.some((g) => r.genres.includes(g))
      );
    }

    if (filter.minYear) {
      releases = releases.filter((r) => r.year >= filter.minYear!);
    }

    if (filter.maxYear) {
      releases = releases.filter((r) => r.year <= filter.maxYear!);
    }

    if (filter.minRating) {
      releases = releases.filter((r) => (r.rating || 0) >= filter.minRating!);
    }

    if (filter.maxRating) {
      releases = releases.filter((r) => (r.rating || 0) <= filter.maxRating!);
    }

    if (filter.styles && filter.styles.length > 0) {
      releases = releases.filter((r) =>
        filter.styles!.some((s) => r.styles.includes(s))
      );
    }

    return releases;
  }

  async getGenres(): Promise<string[]> {
    const releases = await this.db.getAllReleases();
    const genreSet = new Set<string>();

    releases.forEach((r) => {
      const genres = r.genres.split(', ');
      genres.forEach((g) => genreSet.add(g.trim()));
    });

    return Array.from(genreSet).sort();
  }

  async getStats() {
    const releases = await this.db.getAllReleases();
    const genres = await this.getGenres();
    const years = new Set(releases.map((r) => r.year).filter((y) => y !== null && y !== undefined));

    return {
      totalReleases: releases.length,
      totalGenres: genres.length,
      yearsSpan: {
        min: years.size > 0 ? Math.min(...Array.from(years)) : 0,
        max: years.size > 0 ? Math.max(...Array.from(years)) : 0,
      },
      genres,
    };
  }
}
