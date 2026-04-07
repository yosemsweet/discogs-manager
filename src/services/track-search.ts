import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudRateLimitService } from './soundcloud-rate-limit';
import { DatabaseManager } from './database';
import { StoredRelease } from '../types';
import { ProgressCallback, noopProgress } from '../utils/progress';
import { QueryNormalizer } from '../utils/query-normalizer';
import { Logger } from '../utils/logger';
import { TrackMatcher, MatchCandidate, DiscogsTrackInfo } from './track-matcher';
import { runWithConcurrency } from '../utils/concurrency';

/**
 * Handles searching for tracks on SoundCloud given Discogs releases.
 *
 * Performance features:
 * - Bulk cache pre-fetch: all track_matches for the release set loaded in one SQL query
 * - Bounded concurrency: up to `concurrency` releases processed in parallel (default 8)
 * - Negative-match cache: tracks with recent 'pending' unmatched_tracks entries are
 *   skipped automatically (bypass with exhaustive: true)
 * - Strategy stats: records which fallback query strategy produced each match; prunes
 *   strategies with ≥100 observations and <5% hit rate (bypass with exhaustive: true)
 */

export interface TrackSearchOptions {
  /** Max releases to process concurrently. Default: 8. */
  concurrency?: number;
  /**
   * When true, bypass the negative-match cache and strategy pruning.
   * Forces a full re-search even for tracks that previously failed to match.
   */
  exhaustive?: boolean;
}

export class TrackSearchService {
    private static readonly SEARCH_RESULT_LIMIT = 10;
    /** TTL for negative-match cache entries (days). */
    private static readonly NEGATIVE_CACHE_TTL_DAYS = 30;
    /** Minimum strategy observations before pruning is considered. */
    private static readonly STRATEGY_PRUNE_MIN_OBS = 100;
    /** Hit-rate threshold below which a strategy is pruned. */
    private static readonly STRATEGY_PRUNE_THRESHOLD = 0.05;

    constructor(
        private soundcloudClient: SoundCloudAPIClient,
        private db: DatabaseManager,
        private rateLimitService?: SoundCloudRateLimitService
    ) { }

    /**
     * Search for all tracks across multiple releases on SoundCloud.
     * Returns array of {trackId, discogsId, confidence} mappings for found tracks.
     */
    async searchTracksForReleases(
        releases: StoredRelease[],
        onProgress: ProgressCallback = noopProgress,
        playlistTitle?: string,
        options: TrackSearchOptions = {}
    ): Promise<Array<{ trackId: string; discogsId: number; confidence: number }>> {
        const { concurrency = 8, exhaustive = false } = options;

        // --- Bulk cache pre-fetch: one SQL query instead of N per-track queries ---
        const releaseIds = releases.map(r => r.discogsId);
        const cacheMap = this.db.getAllCachedTrackMatches(releaseIds);
        Logger.debug(`Bulk cache pre-fetch: ${cacheMap.size} cached matches for ${releaseIds.length} releases`);

        // --- Strategy pruning: load hit rates once, decide per-strategy ---
        const strategyHitRates = exhaustive ? new Map<number, { attempts: number; hits: number }>() : this.db.getStrategyHitRates();

        let completedReleases = 0;
        const totalReleases = releases.length;

        // --- Concurrent per-release processing ---
        const releaseResults = await runWithConcurrency(releases, concurrency, async (release) => {
            const perRelease: Array<{ trackId: string; discogsId: number; confidence: number }> = [];
            let releaseMatched = 0;
            let releaseSearched = 0;

            try {
                if (this.rateLimitService) {
                    await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                }

                // Get tracks from database for this release
                let tracks: any[] = [];
                try {
                    tracks = await this.db.getTracksForRelease(release.discogsId);
                } catch (error) {
                    Logger.warn(`Failed to fetch tracks for release ${release.discogsId}: ${error}`);
                }

                if (tracks && tracks.length > 0) {
                    let tracksToSearch = tracks;

                    // Try playlist preflight for multi-track releases
                    if (tracks.length > 1) {
                        Logger.debug(`Trying playlist preflight for "${release.title}" (${tracks.length} tracks)`);
                        const preflightResult = await this.searchReleaseAsPlaylist(release, tracks, cacheMap);
                        if (preflightResult) {
                            for (const m of preflightResult.matched) {
                                perRelease.push({ ...m });
                                releaseMatched++;
                            }
                            releaseSearched += tracks.length - preflightResult.unmatchedTracks.length;
                            tracksToSearch = preflightResult.unmatchedTracks;

                            if (tracksToSearch.length === 0) {
                                completedReleases++;
                                onProgress({
                                    stage: 'Searching tracks',
                                    current: completedReleases,
                                    total: totalReleases,
                                    message: `"${release.title}" — ${releaseMatched} matched via playlist preflight`,
                                });
                                return perRelease;
                            }
                        }
                    }

                    // Per-track search for remaining tracks
                    for (const track of tracksToSearch) {
                        releaseSearched++;

                        if (this.rateLimitService) {
                            await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                        }

                        // Check in-memory cache first (from bulk pre-fetch)
                        const cacheKey = `${release.discogsId}|${track.title}`;
                        const cached = cacheMap.get(cacheKey);
                        if (cached) {
                            Logger.debug(
                                `  Cache hit (bulk): "${track.title}" → "${cached.matchedTitle}" ` +
                                `(id: ${cached.soundcloudTrackId}, confidence: ${cached.confidence.toFixed(2)})`
                            );
                            perRelease.push({
                                trackId: cached.soundcloudTrackId,
                                discogsId: release.discogsId,
                                confidence: cached.confidence,
                            });
                            releaseMatched++;
                            continue;
                        }

                        // Negative-match cache check
                        if (!exhaustive && this.db.isKnownUnmatchedTrack(
                            release.discogsId,
                            track.title,
                            TrackSearchService.NEGATIVE_CACHE_TTL_DAYS
                        )) {
                            Logger.debug(
                                `  Negative cache hit: "${track.title}" skipped (known unmatched within ${TrackSearchService.NEGATIVE_CACHE_TTL_DAYS}d TTL)`
                            );
                            continue;
                        }

                        const matchResult = await this.searchWithFallback(
                            track,
                            release,
                            playlistTitle,
                            strategyHitRates,
                            exhaustive
                        );

                        if (matchResult) {
                            perRelease.push({
                                trackId: matchResult.trackId,
                                discogsId: release.discogsId,
                                confidence: matchResult.confidence,
                            });
                            releaseMatched++;
                            // Keep cache map in sync so later releases sharing a track see the hit
                            cacheMap.set(cacheKey, {
                                soundcloudTrackId: matchResult.trackId,
                                confidence: matchResult.confidence,
                                matchedTitle: matchResult.matchedTitle,
                                matchedPermalinkUrl: null,
                            });
                            Logger.debug(
                                `Matched track: "${track.title}" → "${matchResult.matchedTitle}" ` +
                                `(confidence: ${matchResult.confidence.toFixed(2)})`
                            );
                        } else {
                            Logger.warn(`No confident match for "${track.title}" from "${release.title}"`);
                        }
                    }
                }
            } catch (error) {
                Logger.warn(`Failed to process release "${release.title}": ${error}`);
            }

            completedReleases++;
            onProgress({
                stage: 'Searching tracks',
                current: completedReleases,
                total: totalReleases,
                message: `"${release.title}" — ${releaseMatched}/${releaseSearched} matched`,
            });

            return perRelease;
        });

        const trackData = releaseResults.flat();

        const totalMatched = trackData.length;
        const matchRate = releases.length > 0 ? ((totalMatched / releases.length) * 100).toFixed(1) : '0';
        Logger.info(`Track matching complete: ${totalMatched} tracks matched across ${releases.length} releases (${matchRate}% release coverage)`);

        return trackData;
    }

    /**
     * Attempt to resolve all tracks for a release by finding a matching SoundCloud playlist.
     * Checks the in-memory cache map for each playlist track before accepting a playlist match.
     */
    async searchReleaseAsPlaylist(
        release: StoredRelease,
        tracks: any[],
        cacheMap?: Map<string, { soundcloudTrackId: string; confidence: number; matchedTitle: string; matchedPermalinkUrl: string | null }>
    ): Promise<{
        matched: Array<{ trackId: string; discogsId: number; confidence: number }>;
        unmatchedTracks: any[];
    } | null> {
        try {
            const artistName = release.artists || tracks[0]?.artists || '';
            const query = `${artistName} ${release.title}`.trim();

            if (this.rateLimitService) {
                await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
            }

            Logger.debug(`Playlist search query: "${query}"`);
            const playlists = await this.soundcloudClient.searchPlaylists(query, 5);

            if (!playlists || playlists.length === 0) {
                Logger.debug(`Playlist preflight: no results for "${query}"`);
                return null;
            }

            Logger.debug(`Playlist preflight: ${playlists.length} result(s) for "${query}"`);

            for (const p of playlists) {
                const score = TrackMatcher.scorePlaylistMatch(release.title, artistName, p);
                Logger.debug(
                    `  Playlist candidate: "${p.title}" by ${p.user?.username} → score ${score.toFixed(3)}` +
                    (p.permalink_url ? ` (${p.permalink_url})` : '')
                );
            }

            const bestMatch = TrackMatcher.findBestPlaylistMatch(release.title, artistName, playlists);

            if (!bestMatch) {
                Logger.debug(`Playlist preflight: no candidate above threshold`);
                return null;
            }

            Logger.debug(
                `Playlist preflight: selected "${bestMatch.playlist.title}" by ${bestMatch.playlist.user?.username} ` +
                `(confidence: ${bestMatch.confidence.toFixed(3)})`
            );

            if (this.rateLimitService) {
                await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
            }

            const playlistTracks = await this.soundcloudClient.getPlaylistTracks(
                bestMatch.playlist.id.toString()
            );

            if (!playlistTracks || playlistTracks.length === 0) {
                Logger.debug(`Playlist preflight: "${bestMatch.playlist.title}" returned 0 tracks`);
                return null;
            }

            Logger.debug(`Playlist preflight: fetched ${playlistTracks.length} track(s) from playlist`);

            const discogsTrackInfos: DiscogsTrackInfo[] = tracks.map((t: any, i: number) => ({
                title: t.title,
                artists: t.artists || '',
                duration: t.duration || null,
                position: i,
            }));

            const mapping = TrackMatcher.mapPlaylistTracksToRelease(
                playlistTracks as MatchCandidate[],
                discogsTrackInfos
            );

            const matched = mapping.matched.map(m => ({
                trackId: (m.soundcloudTrack.id || (m.soundcloudTrack as any).track_id).toString(),
                discogsId: release.discogsId,
                confidence: bestMatch.confidence,
            }));

            // Cache matched tracks
            for (const m of mapping.matched) {
                const trackId = (m.soundcloudTrack.id || (m.soundcloudTrack as any).track_id).toString();
                const cacheKey = `${release.discogsId}|${m.discogsTrack.title}`;
                try {
                    await this.db.saveCachedTrackMatch(
                        release.discogsId,
                        m.discogsTrack.title,
                        trackId,
                        bestMatch.confidence,
                        m.soundcloudTrack.title,
                        m.soundcloudTrack.user?.username,
                        (m.soundcloudTrack as any).permalink_url || undefined
                    );
                    // Keep in-memory map up to date
                    if (cacheMap) {
                        cacheMap.set(cacheKey, {
                            soundcloudTrackId: trackId,
                            confidence: bestMatch.confidence,
                            matchedTitle: m.soundcloudTrack.title,
                            matchedPermalinkUrl: (m.soundcloudTrack as any).permalink_url || null,
                        });
                    }
                } catch (error) {
                    Logger.debug(`Failed to cache playlist match for "${m.discogsTrack.title}": ${error}`);
                }
            }

            const unmatchedTracks = mapping.unmatched.map(um => tracks[um.position]);

            Logger.info(
                `Playlist preflight for "${release.title}": ${matched.length}/${tracks.length} tracks resolved`
            );

            return { matched, unmatchedTracks };
        } catch (error) {
            Logger.warn(`Playlist preflight failed for "${release.title}": ${error}`);
            return null;
        }
    }

    /**
     * Search for a track using multiple fallback strategies with caching.
     *
     * Strategy pruning: strategies with ≥STRATEGY_PRUNE_MIN_OBS observations and
     * <STRATEGY_PRUNE_THRESHOLD hit rate are skipped (bypassed when exhaustive=true).
     */
    private async searchWithFallback(
        track: any,
        release: StoredRelease,
        playlistTitle?: string,
        strategyHitRates: Map<number, { attempts: number; hits: number }> = new Map(),
        exhaustive: boolean = false
    ): Promise<{ trackId: string; matchedTitle: string; confidence: number } | null> {
        const effectiveArtist = track.artists || release.artists || '';
        Logger.debug(`Per-track search: "${track.title}" by ${effectiveArtist || '(unknown)'} from "${release.title}"`);

        const strategies = QueryNormalizer.buildQueryStrategies(
            track.title,
            effectiveArtist,
            release.title
        );

        let lastSearchResults: MatchCandidate[] = [];
        let matchedStrategyIndex = -1;

        for (let i = 0; i < strategies.length; i++) {
            // Strategy pruning: skip if hit rate is below threshold (and enough observations)
            if (!exhaustive) {
                const stats = strategyHitRates.get(i);
                if (
                    stats &&
                    stats.attempts >= TrackSearchService.STRATEGY_PRUNE_MIN_OBS &&
                    stats.hits / stats.attempts < TrackSearchService.STRATEGY_PRUNE_THRESHOLD
                ) {
                    Logger.debug(`  Strategy ${i + 1} pruned (${stats.hits}/${stats.attempts} = ${(stats.hits / stats.attempts * 100).toFixed(1)}% < ${TrackSearchService.STRATEGY_PRUNE_THRESHOLD * 100}%)`);
                    continue;
                }
            }

            const query = strategies[i];

            try {
                if (this.rateLimitService) {
                    await this.soundcloudClient.throttleIfApproachingLimit(this.rateLimitService);
                }

                const response = await this.soundcloudClient.searchTrack(
                    query,
                    TrackSearchService.SEARCH_RESULT_LIMIT
                );
                const searchResults = Array.isArray(response) ? response : (response?.collection || []);

                Logger.debug(`  Strategy ${i + 1}/${strategies.length}: "${query}" → ${searchResults?.length ?? 0} result(s)`);

                if (searchResults && searchResults.length > 0) {
                    lastSearchResults = searchResults as MatchCandidate[];

                    const bestMatch = TrackMatcher.findBestMatch(
                        track.title,
                        effectiveArtist,
                        track.duration || null,
                        lastSearchResults
                    );

                    const allScored = TrackMatcher.findAllMatches(
                        track.title, effectiveArtist, track.duration || null,
                        lastSearchResults, 0.0
                    );
                    for (const scored of allScored.slice(0, 3)) {
                        const bd = scored.breakdown;
                        Logger.debug(
                            `    "${scored.candidate.title}" by ${scored.candidate.user?.username} → ` +
                            `${(scored.confidence * 100).toFixed(0)}% ` +
                            `(title:${(bd.titleScore * 100).toFixed(0)}% artist:${(bd.artistScore * 100).toFixed(0)}% dur:${(bd.durationScore * 100).toFixed(0)}%)`
                        );
                    }

                    // Record attempt regardless of match outcome
                    this.db.recordStrategyOutcome(i, !!bestMatch);
                    // Update in-memory map so pruning decisions within this session
                    // reflect the new data (best-effort — does not affect other sessions)
                    const existing = strategyHitRates.get(i);
                    strategyHitRates.set(i, {
                        attempts: (existing?.attempts ?? 0) + 1,
                        hits: (existing?.hits ?? 0) + (bestMatch ? 1 : 0),
                    });

                    if (bestMatch) {
                        matchedStrategyIndex = i;
                        Logger.debug(
                            `  ✓ Match found via strategy ${i + 1}: "${bestMatch.candidate.title}" by ${bestMatch.candidate.user?.username} ` +
                            `(${(bestMatch.confidence * 100).toFixed(0)}%)`
                        );

                        const result = {
                            trackId: (bestMatch.candidate.id || (bestMatch.candidate as any).track_id).toString(),
                            matchedTitle: bestMatch.candidate.title,
                            confidence: bestMatch.confidence,
                        };

                        try {
                            await this.db.saveCachedTrackMatch(
                                release.discogsId,
                                track.title,
                                result.trackId,
                                result.confidence,
                                result.matchedTitle,
                                bestMatch.candidate.user?.username,
                                (bestMatch.candidate as any).permalink_url || undefined
                            );
                        } catch (error) {
                            Logger.debug(`Failed to cache match for "${track.title}": ${error}`);
                        }

                        return result;
                    }
                }
            } catch (error) {
                Logger.debug(`Search failed for query "${query}": ${error}`);
            }
        }

        Logger.debug(`  ✗ No match for "${track.title}" after ${strategies.length} strategies`);

        if (playlistTitle) {
            try {
                const nearMisses = TrackMatcher.findAllMatches(
                    track.title,
                    effectiveArtist,
                    track.duration || null,
                    lastSearchResults,
                    0.3
                ).slice(0, 3);

                const topCandidatesJson = nearMisses.length > 0
                    ? JSON.stringify(nearMisses.map(m => ({
                        id: (m.candidate.id || (m.candidate as any).track_id || '').toString(),
                        title: m.candidate.title,
                        username: m.candidate.user?.username,
                        duration: m.candidate.duration,
                        confidence: m.confidence,
                        breakdown: m.breakdown,
                    })))
                    : null;

                await this.db.saveUnmatchedTrack({
                    playlistTitle,
                    discogsReleaseId: release.discogsId,
                    discogsTrackTitle: track.title,
                    discogsArtist: effectiveArtist || null,
                    discogsDuration: track.duration || null,
                    releaseTitle: release.title,
                    topCandidatesJson,
                    strategiesTriedCount: strategies.length,
                });
            } catch (error) {
                Logger.debug(`Failed to save unmatched track "${track.title}": ${error}`);
            }
        }

        return null;
    }
}
