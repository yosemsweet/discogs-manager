import { DiscogsAPIClient, DiscogsAPIClientError } from '../api/discogs';
import { DatabaseManager } from './database';
import { DiscogsRelease, PlaylistFilter, StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { Logger } from '../utils/logger';

export class CollectionService {
  private discogsClient: DiscogsAPIClient;
  private db: DatabaseManager;

  constructor(discogsClient: DiscogsAPIClient, db: DatabaseManager) {
    this.discogsClient = discogsClient;
    this.db = db;
  }

  async syncCollection(username: string, onProgress: ProgressCallback = noopProgress, forceRefresh: boolean = false) {
    try {
      onProgress({ stage: 'Fetching collection', current: 0, total: 0 });
      
      const collection = await this.discogsClient.getCollectionPaginated(username);
      const releases = collection.releases || [];
      const totalReleases = releases.length;
      const totalPages = collection.pagination?.pages || 1;

      let processedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let currentPage = 1;
      
      for (const release of releases) {
        // Update page number based on items processed
        const itemsPerPage = 50;
        currentPage = Math.floor(processedCount / itemsPerPage) + 1;
        
        // Check if release already exists unless force refresh is enabled
        if (!forceRefresh && await this.db.releaseExists(release.id)) {
          skippedCount++;
          onProgress({
            stage: 'Syncing releases',
            current: processedCount + skippedCount + 1,
            total: totalReleases,
            currentPage,
            totalPages,
            message: `Skipped existing release ${release.basic_information?.title || 'unknown'}`,
          });
          continue;
        }
        
        onProgress({
          stage: 'Syncing releases',
          current: processedCount + skippedCount + 1,
          total: totalReleases,
          currentPage,
          totalPages,
          message: `Fetching details for ${release.basic_information?.title || 'unknown'}`,
        });

        try {
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
          
          // Store the tracklist for later use
          if (releaseDetails.tracklist && Array.isArray(releaseDetails.tracklist)) {
            await this.db.addTracks(releaseDetails.id, releaseDetails.tracklist);
          }
          
          processedCount++;
        } catch (error) {
          failedCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          Logger.warn(`Failed to fetch release ${release.id}: ${errorMsg}`);

          // Check if it's a 404 (not found) - don't retry permanently missing items
          if (error instanceof DiscogsAPIClientError && error.statusCode === 404) {
            await this.db.moveToDLQ(release.id, username, `404 Not Found: ${errorMsg}`);
            Logger.info(`Moved release ${release.id} to DLQ (404)`);
          } else {
            // For other errors, add to retry queue
            await this.db.addToRetryQueue(release.id, username, errorMsg);
            Logger.info(`Queued release ${release.id} for retry`);
          }
        }
      }

      onProgress({
        stage: 'Completed',
        current: totalReleases,
        total: totalReleases,
        message: `Synced ${processedCount}/${totalReleases} releases. ${skippedCount} skipped (already in DB). ${failedCount} failures queued for retry.`,
      });

      return processedCount;
    } catch (error) {
      throw new Error(`Failed to sync collection: ${error}`);
    }
  }

  async syncSpecificReleases(
    username: string,
    releaseIds: number[],
    onProgress: ProgressCallback = noopProgress,
    forceRefresh: boolean = false
  ) {
    try {
      onProgress({ stage: 'Fetching specific releases', current: 0, total: releaseIds.length });

      let processedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const releaseId of releaseIds) {
        // Check if release already exists unless force refresh is enabled
        if (!forceRefresh && await this.db.releaseExists(releaseId)) {
          skippedCount++;
          onProgress({
            stage: 'Syncing releases',
            current: processedCount + skippedCount + 1,
            total: releaseIds.length,
            message: `Skipped existing release ${releaseId}`,
          });
          continue;
        }

        onProgress({
          stage: 'Syncing releases',
          current: processedCount + skippedCount + 1,
          total: releaseIds.length,
          message: `Fetching details for release ${releaseId}`,
        });

        try {
          const releaseDetails = await this.discogsClient.getRelease(releaseId);
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

          // Store the tracklist for later use
          if (releaseDetails.tracklist && Array.isArray(releaseDetails.tracklist)) {
            await this.db.addTracks(releaseDetails.id, releaseDetails.tracklist);
          }

          processedCount++;
        } catch (error) {
          failedCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          Logger.warn(`Failed to fetch release ${releaseId}: ${errorMsg}`);

          // Check if it's a 404 (not found) - don't retry permanently missing items
          if (error instanceof DiscogsAPIClientError && error.statusCode === 404) {
            await this.db.moveToDLQ(releaseId, username, `404 Not Found: ${errorMsg}`);
            Logger.info(`Moved release ${releaseId} to DLQ (404)`);
          } else {
            // For other errors, add to retry queue
            await this.db.addToRetryQueue(releaseId, username, errorMsg);
            Logger.info(`Queued release ${releaseId} for retry`);
          }
        }
      }

      onProgress({
        stage: 'Sync complete',
        current: releaseIds.length,
        total: releaseIds.length,
        message: `Synced ${processedCount}/${releaseIds.length} releases. ${skippedCount} skipped (already in DB). ${failedCount} failures queued for retry.`,
      });

      return processedCount;
    } catch (error) {
      throw new Error(`Failed to sync specific releases: ${error}`);
    }
  }

  async processRetryQueue(username: string, onProgress: ProgressCallback = noopProgress) {
    try {
      const retryItems = await this.db.getRetryQueueItems(username);
      if (retryItems.length === 0) {
        onProgress({ stage: 'Retry queue empty', current: 0, total: 0 });
        return { successCount: 0, failureCount: 0 };
      }

      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < retryItems.length; i++) {
        const item = retryItems[i];

        onProgress({
          stage: 'Processing retry queue',
          current: i + 1,
          total: retryItems.length,
          message: `Retrying release ${item.releaseId} (attempt ${item.attemptCount})`,
        });

        try {
          const releaseDetails = await this.discogsClient.getRelease(item.releaseId);
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
          await this.db.removeFromRetryQueue(item.releaseId, username);
          successCount++;
          Logger.info(`Successfully retried release ${item.releaseId}`);
        } catch (error) {
          failureCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);

          // If 404 or max retries (3), move to DLQ
          if (
            (error instanceof DiscogsAPIClientError && error.statusCode === 404) ||
            item.attemptCount >= 3
          ) {
            await this.db.moveToDLQ(item.releaseId, username, errorMsg);
            await this.db.removeFromRetryQueue(item.releaseId, username);
            Logger.warn(`Moved release ${item.releaseId} to DLQ after ${item.attemptCount} retries`);
          } else {
            await this.db.incrementRetryAttempt(item.releaseId, username, errorMsg);
            Logger.warn(`Retry attempt ${item.attemptCount + 1} scheduled for release ${item.releaseId}`);
          }
        }
      }

      return { successCount, failureCount };
    } catch (error) {
      throw new Error(`Failed to process retry queue: ${error}`);
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

  async getGenreStats(): Promise<Map<string, number>> {
    const releases = await this.db.getAllReleases();
    const genreMap = new Map<string, number>();

    releases.forEach((r) => {
      const genres = r.genres.split(', ');
      genres.forEach((g) => {
        const trimmed = g.trim();
        genreMap.set(trimmed, (genreMap.get(trimmed) || 0) + 1);
      });
    });

    // Sort by count descending, then by name ascending
    return new Map(
      Array.from(genreMap.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]; // Sort by count descending
        return a[0].localeCompare(b[0]); // Then by name ascending
      })
    );
  }

  async getStyleStats(): Promise<Map<string, number>> {
    const releases = await this.db.getAllReleases();
    const styleMap = new Map<string, number>();

    releases.forEach((r) => {
      if (r.styles) {
        const styles = r.styles.split(', ');
        styles.forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) {
            styleMap.set(trimmed, (styleMap.get(trimmed) || 0) + 1);
          }
        });
      }
    });

    // Sort by count descending, then by name ascending
    return new Map(
      Array.from(styleMap.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]; // Sort by count descending
        return a[0].localeCompare(b[0]); // Then by name ascending
      })
    );
  }

  async getStats(verbose: boolean = false) {
    const releases = await this.db.getAllReleases();
    const genreStats = await this.getGenreStats();
    const years = new Set(releases.map((r) => r.year).filter((y) => y !== null && y !== undefined));

    const stats: any = {
      totalReleases: releases.length,
      totalGenres: genreStats.size,
      yearsSpan: {
        min: years.size > 0 ? Math.min(...Array.from(years)) : 0,
        max: years.size > 0 ? Math.max(...Array.from(years)) : 0,
      },
      genreStats,
    };

    // Only calculate style stats if verbose mode is requested
    if (verbose) {
      stats.styleStats = await this.getStyleStats();
    }

    return stats;
  }
}
