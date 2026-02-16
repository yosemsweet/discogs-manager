import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from './database';
import { DiscogsRelease, PlaylistFilter, StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';

export class CollectionService {
  private discogsClient: DiscogsAPIClient;
  private db: DatabaseManager;

  constructor(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
    this.discogsClient = discogsClient;
    this.db = db;
  }

  async syncCollection(username: string, onProgress: ProgressCallback = noopProgress) {
    try {
      onProgress({ stage: 'Fetching collection', current: 0, total: 0 });
      
      const collection = await this.discogsClient.getCollectionPaginated(username);
      const releases = collection.releases || [];
      const totalReleases = releases.length;
      const totalPages = collection.pagination?.pages || 1;

      let processedCount = 0;
      let currentPage = 1;
      
      for (const release of releases) {
        // Update page number based on items processed
        const itemsPerPage = 50;
        currentPage = Math.floor(processedCount / itemsPerPage) + 1;
        
        onProgress({
          stage: 'Syncing releases',
          current: processedCount + 1,
          total: totalReleases,
          currentPage,
          totalPages,
          message: `Fetching details for ${release.basic_information?.title || 'unknown'}`,
        });

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

      onProgress({
        stage: 'Completed',
        current: totalReleases,
        total: totalReleases,
        message: 'All releases synced successfully',
      });

      return processedCount;
    } catch (error) {
      throw new Error(`Failed to sync collection: ${error}`);
    }
  }

  async filterReleases(filter: PlaylistFilter, onProgress: ProgressCallback = noopProgress): Promise<StoredRelease[]> {
    let releases = await this.db.getAllReleases();
    const totalReleases = releases.length;
    let currentStep = 0;
    const totalSteps = 6; // genres, minYear, maxYear, minRating, maxRating, styles

    onProgress({ stage: 'Loading releases', current: 0, total: totalReleases });

    if (filter.genres && filter.genres.length > 0) {
      currentStep++;
      onProgress({ stage: `Filtering by genres ${filter.genres.join(', ')}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) =>
        filter.genres!.some((g) => r.genres.includes(g))
      );
    }

    if (filter.minYear) {
      currentStep++;
      onProgress({ stage: `Filtering min year ${filter.minYear}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) => r.year >= filter.minYear!);
    }

    if (filter.maxYear) {
      currentStep++;
      onProgress({ stage: `Filtering max year ${filter.maxYear}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) => r.year <= filter.maxYear!);
    }

    if (filter.minRating) {
      currentStep++;
      onProgress({ stage: `Filtering min rating ${filter.minRating}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) => (r.rating || 0) >= filter.minRating!);
    }

    if (filter.maxRating) {
      currentStep++;
      onProgress({ stage: `Filtering max rating ${filter.maxRating}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) => (r.rating || 0) <= filter.maxRating!);
    }

    if (filter.styles && filter.styles.length > 0) {
      currentStep++;
      onProgress({ stage: `Filtering by styles ${filter.styles.join(', ')}`, current: currentStep, total: totalSteps });
      releases = releases.filter((r) =>
        filter.styles!.some((s) => r.styles.includes(s))
      );
    }

    onProgress({ stage: 'Filtering complete', current: totalSteps, total: totalSteps, message: `Found ${releases.length} matching releases` });

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
