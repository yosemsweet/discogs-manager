/**
 * Input validation utility for CLI arguments, API responses, and service inputs
 * Provides schema validation, type guards, and detailed error messages
 */

import { PlaylistFilter, StoredRelease, DiscogsRelease, SoundCloudPlaylist } from '../types';
import { ErrorHandler, ErrorType, AppError } from './error-handler';

/**
 * Validation error class for clear error messages
 */
export class ValidationError extends Error {
    constructor(public field: string, public reason: string) {
        super(`Validation error: ${field} - ${reason}`);
        this.name = 'ValidationError';
    }
}

/**
 * Validator utility with schema validation and type guards
 */
export class Validator {
    /**
     * Validate CLI command options
     */
    static validateSyncOptions(options: any): {
        username: string;
        force: boolean;
        releaseIds?: number[];
    } {
        // Username is required - check options first, then env
        let username: string | undefined = options.username;
        if (username === undefined) {
            username = process.env.DISCOGS_USERNAME;
        }

        if (!username || typeof username !== 'string') {
            throw new ValidationError('username', 'Username is required. Use --username or set DISCOGS_USERNAME');
        }

        const trimmed = username.trim();
        if (trimmed.length === 0) {
            throw new ValidationError('username', 'Username cannot be empty');
        }

        if (trimmed.length > 50) {
            throw new ValidationError('username', 'Username must be 50 characters or less');
        }

        const force = Boolean(options.force);

        // Validate release IDs if provided
        let releaseIds: number[] | undefined;
        if (options.releaseIds) {
            releaseIds = this.validateReleaseIds(options.releaseIds);
        }

        return { username: trimmed, force, releaseIds };
    }

    /**
     * Validate list command options
     */
    static validateListOptions(options: any): {
        username: string;
        limit: number;
        filter: PlaylistFilter;
    } {
        let username: string | undefined = options.username;
        if (username === undefined) {
            username = process.env.DISCOGS_USERNAME;
        }

        if (!username || typeof username !== 'string') {
            throw new ValidationError('username', 'Username is required. Use --username or set DISCOGS_USERNAME');
        }

        const trimmedUsername = username.trim();
        if (trimmedUsername.length === 0 || trimmedUsername.length > 50) {
            throw new ValidationError('username', 'Username must be non-empty and <= 50 characters');
        }

        const limit = options.limit ? parseInt(options.limit) : 50;
        if (isNaN(limit) || limit < 1 || limit > 10000) {
            throw new ValidationError('limit', 'Limit must be between 1 and 10000');
        }

        const filter: PlaylistFilter = {};

        if (options.genres && typeof options.genres === 'string') {
            const genres = options.genres.split(',').map((g: string) => g.trim()).filter((g: string) => g.length > 0);
            if (genres.length === 0) {
                throw new ValidationError('genres', 'At least one genre must be provided');
            }
            for (const genre of genres) {
                if (genre.length > 100) {
                    throw new ValidationError('genres', 'Genre names must be <= 100 characters');
                }
            }
            filter.genres = genres;
        }

        if (options.minYear) {
            const year = parseInt(options.minYear);
            if (isNaN(year) || year < 1800 || year > 2100) {
                throw new ValidationError('minYear', 'minYear must be between 1800 and 2100');
            }
            filter.minYear = year;
        }

        if (options.maxYear) {
            const year = parseInt(options.maxYear);
            if (isNaN(year) || year < 1800 || year > 2100) {
                throw new ValidationError('maxYear', 'maxYear must be between 1800 and 2100');
            }
            filter.maxYear = year;
        }

        if (filter.minYear && filter.maxYear && filter.minYear > filter.maxYear) {
            throw new ValidationError('years', 'minYear must be <= maxYear');
        }

        if (options.styles && typeof options.styles === 'string') {
            const styles = options.styles.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
            if (styles.length === 0) {
                throw new ValidationError('styles', 'At least one style must be provided');
            }
            for (const style of styles) {
                if (style.length > 100) {
                    throw new ValidationError('styles', 'Style names must be <= 100 characters');
                }
            }
            filter.styles = styles;
        }

        if (options.minRating) {
            const rating = parseFloat(options.minRating);
            if (isNaN(rating) || rating < 0 || rating > 5) {
                throw new ValidationError('minRating', 'minRating must be between 0 and 5');
            }
            filter.minRating = rating;
        }

        if (options.maxRating) {
            const rating = parseFloat(options.maxRating);
            if (isNaN(rating) || rating < 0 || rating > 5) {
                throw new ValidationError('maxRating', 'maxRating must be between 0 and 5');
            }
            filter.maxRating = rating;
        }

        if (filter.minRating && filter.maxRating && filter.minRating > filter.maxRating) {
            throw new ValidationError('ratings', 'minRating must be <= maxRating');
        }

        return { username: trimmedUsername, limit, filter };
    }

    /**
     * Validate playlist command options
     */
    static validatePlaylistOptions(options: any): {
        title: string;
        description?: string;
        isPrivate: boolean;
        filter: PlaylistFilter;
        releaseIds?: number[];
    } {
        if (!options.title || typeof options.title !== 'string') {
            throw new ValidationError('title', 'Title is required');
        }

        const title = options.title.trim();
        if (title.length === 0) {
            throw new ValidationError('title', 'Title cannot be empty');
        }

        if (title.length > 200) {
            throw new ValidationError('title', 'Title must be 200 characters or less');
        }

        let description: string | undefined;
        if (options.description) {
            description = String(options.description).trim();
            if (description.length > 1000) {
                throw new ValidationError('description', 'Description must be 1000 characters or less');
            }
        }

        const isPrivate = Boolean(options.private);

        const filter: PlaylistFilter = {};

        if (options.genres && typeof options.genres === 'string') {
            const genres = options.genres.split(',').map((g: string) => g.trim()).filter((g: string) => g.length > 0);
            if (genres.length === 0) {
                throw new ValidationError('genres', 'At least one genre must be provided');
            }
            filter.genres = genres;
        }

        if (options.minYear) {
            const year = parseInt(options.minYear);
            if (isNaN(year) || year < 1800 || year > 2100) {
                throw new ValidationError('minYear', 'minYear must be between 1800 and 2100');
            }
            filter.minYear = year;
        }

        if (options.maxYear) {
            const year = parseInt(options.maxYear);
            if (isNaN(year) || year < 1800 || year > 2100) {
                throw new ValidationError('maxYear', 'maxYear must be between 1800 and 2100');
            }
            filter.maxYear = year;
        }

        if (filter.minYear && filter.maxYear && filter.minYear > filter.maxYear) {
            throw new ValidationError('years', 'minYear must be <= maxYear');
        }

        let releaseIds: number[] | undefined;
        if (options.releaseIds) {
            releaseIds = this.validateReleaseIds(options.releaseIds);
        }

        return { title, description, isPrivate, filter, releaseIds };
    }

    /**
     * Validate stats command options
     */
    static validateStatsOptions(options: any): {
        username: string;
    } {
        let username: string | undefined = options.username;
        if (username === undefined) {
            username = process.env.DISCOGS_USERNAME;
        }

        if (!username || typeof username !== 'string') {
            throw new ValidationError('username', 'Username is required. Use --username or set DISCOGS_USERNAME');
        }

        const trimmed = username.trim();
        if (trimmed.length === 0 || trimmed.length > 50) {
            throw new ValidationError('username', 'Username must be non-empty and <= 50 characters');
        }

        return { username: trimmed };
    }

    /**
     * Validate release IDs from comma-separated string
     */
    private static validateReleaseIds(releaseIdsStr: string): number[] {
        if (typeof releaseIdsStr !== 'string' || releaseIdsStr.trim().length === 0) {
            throw new ValidationError('releaseIds', 'Release IDs cannot be empty');
        }

        const ids = releaseIdsStr.split(',').map((id: string) => {
            const parsed = parseInt(id.trim());
            if (isNaN(parsed) || parsed <= 0) {
                throw new ValidationError('releaseIds', `Invalid release ID: "${id.trim()}". Must be positive integers.`);
            }
            return parsed;
        });

        if (ids.length === 0) {
            throw new ValidationError('releaseIds', 'At least one release ID must be provided');
        }

        if (ids.length > 1000) {
            throw new ValidationError('releaseIds', 'Cannot process more than 1000 release IDs at once');
        }

        // Check for duplicates
        const uniqueIds = new Set(ids);
        if (uniqueIds.size !== ids.length) {
            throw new ValidationError('releaseIds', 'Duplicate release IDs found');
        }

        return ids;
    }

    /**
     * Validate Discogs API response
     */
    static validateDiscogsRelease(release: any): release is DiscogsRelease {
        if (!release || typeof release !== 'object') {
            throw new ValidationError('release', 'Release must be an object');
        }

        if (typeof release.id !== 'number' || release.id <= 0) {
            throw new ValidationError('release.id', 'Release ID must be a positive number');
        }

        if (typeof release.title !== 'string' || release.title.trim().length === 0) {
            throw new ValidationError('release.title', 'Release title must be a non-empty string');
        }

        if (!Array.isArray(release.artists)) {
            throw new ValidationError('release.artists', 'Artists must be an array');
        }

        if (typeof release.year !== 'number' || release.year < 0 || release.year > 2100) {
            throw new ValidationError('release.year', 'Year must be between 0 and 2100');
        }

        if (!Array.isArray(release.genres)) {
            throw new ValidationError('release.genres', 'Genres must be an array');
        }

        if (!Array.isArray(release.styles)) {
            throw new ValidationError('release.styles', 'Styles must be an array');
        }

        if (typeof release.uri !== 'string') {
            throw new ValidationError('release.uri', 'URI must be a string');
        }

        if (typeof release.resource_url !== 'string') {
            throw new ValidationError('release.resource_url', 'Resource URL must be a string');
        }

        return true;
    }

    /**
     * Validate stored release in database
     */
    static validateStoredRelease(release: any): release is StoredRelease {
        if (!release || typeof release !== 'object') {
            throw new ValidationError('release', 'Release must be an object');
        }

        if (typeof release.discogsId !== 'number' || release.discogsId <= 0) {
            throw new ValidationError('release.discogsId', 'Discogs ID must be a positive number');
        }

        if (typeof release.title !== 'string' || release.title.trim().length === 0) {
            throw new ValidationError('release.title', 'Title must be a non-empty string');
        }

        if (typeof release.artists !== 'string') {
            throw new ValidationError('release.artists', 'Artists must be a string');
        }

        if (typeof release.year !== 'number' || release.year < 0 || release.year > 2100) {
            throw new ValidationError('release.year', 'Year must be between 0 and 2100');
        }

        if (typeof release.genres !== 'string') {
            throw new ValidationError('release.genres', 'Genres must be a string');
        }

        if (typeof release.styles !== 'string') {
            throw new ValidationError('release.styles', 'Styles must be a string');
        }

        if (!(release.addedAt instanceof Date)) {
            throw new ValidationError('release.addedAt', 'addedAt must be a Date');
        }

        return true;
    }

    /**
     * Validate SoundCloud API response
     */
    static validateSoundCloudPlaylist(playlist: any): playlist is SoundCloudPlaylist {
        if (!playlist || typeof playlist !== 'object') {
            throw new ValidationError('playlist', 'Playlist must be an object');
        }

        if (!playlist.id || typeof playlist.id !== 'string') {
            throw new ValidationError('playlist.id', 'Playlist ID must be a non-empty string');
        }

        if (typeof playlist.title !== 'string' || playlist.title.trim().length === 0) {
            throw new ValidationError('playlist.title', 'Playlist title must be a non-empty string');
        }

        if (typeof playlist.description !== 'string') {
            throw new ValidationError('playlist.description', 'Playlist description must be a string');
        }

        if (typeof playlist.trackCount !== 'number' || playlist.trackCount < 0) {
            throw new ValidationError('playlist.trackCount', 'Track count must be a non-negative number');
        }

        if (typeof playlist.uri !== 'string') {
            throw new ValidationError('playlist.uri', 'URI must be a string');
        }

        return true;
    }

    /**
     * Validate playlist filter
     */
    static validatePlaylistFilter(filter: PlaylistFilter): void {
        if (!filter || typeof filter !== 'object') {
            throw new ValidationError('filter', 'Filter must be an object');
        }

        if (filter.genres && !Array.isArray(filter.genres)) {
            throw new ValidationError('filter.genres', 'Genres must be an array');
        }

        if (filter.minYear && (typeof filter.minYear !== 'number' || filter.minYear < 1800 || filter.minYear > 2100)) {
            throw new ValidationError('filter.minYear', 'minYear must be between 1800 and 2100');
        }

        if (filter.maxYear && (typeof filter.maxYear !== 'number' || filter.maxYear < 1800 || filter.maxYear > 2100)) {
            throw new ValidationError('filter.maxYear', 'maxYear must be between 1800 and 2100');
        }

        if (filter.minYear && filter.maxYear && filter.minYear > filter.maxYear) {
            throw new ValidationError('filter', 'minYear must be <= maxYear');
        }

        if (filter.minRating && (typeof filter.minRating !== 'number' || filter.minRating < 0 || filter.minRating > 5)) {
            throw new ValidationError('filter.minRating', 'minRating must be between 0 and 5');
        }

        if (filter.maxRating && (typeof filter.maxRating !== 'number' || filter.maxRating < 0 || filter.maxRating > 5)) {
            throw new ValidationError('filter.maxRating', 'maxRating must be between 0 and 5');
        }

        if (filter.minRating && filter.maxRating && filter.minRating > filter.maxRating) {
            throw new ValidationError('filter', 'minRating must be <= maxRating');
        }

        if (filter.styles && !Array.isArray(filter.styles)) {
            throw new ValidationError('filter.styles', 'Styles must be an array');
        }
    }

    /**
     * Validate track array for batch operations
     */
    static validateTrackIds(trackIds: any[]): trackIds is string[] {
        if (!Array.isArray(trackIds)) {
            throw new ValidationError('trackIds', 'Track IDs must be an array');
        }

        if (trackIds.length === 0) {
            throw new ValidationError('trackIds', 'Track IDs array cannot be empty');
        }

        if (trackIds.length > 10000) {
            throw new ValidationError('trackIds', 'Cannot process more than 10000 tracks at once');
        }

        for (let i = 0; i < trackIds.length; i++) {
            if (typeof trackIds[i] !== 'string' || trackIds[i].trim().length === 0) {
                throw new ValidationError(`trackIds[${i}]`, 'Track ID must be a non-empty string');
            }
        }

        return true;
    }

    /**
     * Validate string is non-empty and within length limits
     */
    static validateString(value: any, fieldName: string, minLength: number = 1, maxLength: number = 500): string {
        if (typeof value !== 'string') {
            throw new ValidationError(fieldName, 'Must be a string');
        }

        const trimmed = value.trim();
        if (trimmed.length < minLength) {
            throw new ValidationError(fieldName, `Must be at least ${minLength} character(s)`);
        }

        if (trimmed.length > maxLength) {
            throw new ValidationError(fieldName, `Must be at most ${maxLength} character(s)`);
        }

        return trimmed;
    }

    /**
     * Validate number is within range
     */
    static validateNumber(value: any, fieldName: string, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number {
        const num = typeof value === 'string' ? parseInt(value) : value;

        if (typeof num !== 'number' || isNaN(num)) {
            throw new ValidationError(fieldName, 'Must be a number');
        }

        if (num < min || num > max) {
            throw new ValidationError(fieldName, `Must be between ${min} and ${max}`);
        }

        return num;
    }
}
