/**
 * QueryNormalizer - Utilities for normalizing track/artist/album names for search queries
 *
 * Handles common formatting variations that reduce match quality:
 * - Parentheticals (Remastered, Remix, Edit, Version, feat.)
 * - Featuring syntax variations (feat., ft., featuring)
 * - Special characters and punctuation
 * - Whitespace normalization
 */
export class QueryNormalizer {
  /**
   * Normalize track title for searching
   * Removes common parentheticals and normalizes formatting
   *
   * @example
   * normalizeTrackTitle("Love Me Do (Remastered 2009)")
   * // Returns: "Love Me Do"
   *
   * @example
   * normalizeTrackTitle("Song Name [feat. Artist Name]")
   * // Returns: "Song Name"
   */
  static normalizeTrackTitle(title: string): string {
    if (!title || typeof title !== 'string') {
      return '';
    }

    return title
      .trim()
      // Remove common parentheticals that reduce match quality
      .replace(/\(.*?(remaster|remix|edit|version|radio|album|single|explicit|clean).*?\)/gi, '')
      // Remove featuring information in parentheses/brackets (we'll add artist separately)
      .replace(/[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+[^\)\]]+[\)\]]?/gi, '')
      // Remove square brackets with content
      .replace(/\[[^\]]*\]/g, '')
      // Remove special characters that may interfere (keep apostrophes, hyphens)
      .replace(/[^\w\s'\-]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize artist names for searching
   * Handles common artist name variations
   *
   * @example
   * normalizeArtistName("The Beatles & Friends")
   * // Returns: "The Beatles Friends"
   */
  static normalizeArtistName(artist: string): string {
    if (!artist || typeof artist !== 'string') {
      return '';
    }

    return artist
      .trim()
      // Normalize "and" syntax
      .replace(/\s*&\s*/g, ' ')
      .replace(/\s+and\s+/gi, ' ')
      // Normalize featuring (will be handled separately)
      .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+/gi, ' ')
      // Remove common prefixes that may hurt matching
      .replace(/^the\s+/gi, '')
      // Remove special characters except spaces and hyphens
      .replace(/[^\w\s\-]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract primary artist from a string that may contain featuring artists
   *
   * @example
   * extractPrimaryArtist("Main Artist feat. Featured Artist")
   * // Returns: "Main Artist"
   */
  static extractPrimaryArtist(artists: string): string {
    if (!artists || typeof artists !== 'string') {
      return '';
    }

    // Split on featuring syntax and take first part
    const primary = artists.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0];
    return this.normalizeArtistName(primary);
  }

  /**
   * Extract featuring artists from track title or artist field
   *
   * @example
   * extractFeaturingArtists("Song Name (feat. Artist One & Artist Two)")
   * // Returns: ["Artist One", "Artist Two"]
   */
  static extractFeaturingArtists(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Match featuring syntax in various formats
    const patterns = [
      /[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+([^\)\]]+)[\)\]]?/gi,
    ];

    const featuring: string[] = [];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          // Split on common delimiters (comma, &, and)
          const artists = match[1].split(/[,&]|\s+and\s+/i);
          featuring.push(...artists.map(a => this.normalizeArtistName(a)));
        }
      }
    }

    return featuring.filter(a => a.length > 0);
  }

  /**
   * Build optimized search query from track, artist, and release information
   *
   * @param trackTitle - Track/song title
   * @param artists - Artist name(s)
   * @param releaseTitle - Album/release title (optional but recommended)
   * @returns Normalized search query string
   *
   * @example
   * buildSearchQuery("Love Me Do (Remastered)", "The Beatles", "Please Please Me")
   * // Returns: "Love Me Do Beatles Please Please Me"
   */
  static buildSearchQuery(
    trackTitle: string,
    artists: string,
    releaseTitle?: string
  ): string {
    const parts: string[] = [];

    // Add normalized track title
    const normalizedTrack = this.normalizeTrackTitle(trackTitle);
    if (normalizedTrack) {
      parts.push(normalizedTrack);
    }

    // Add primary artist (most important for matching)
    const primaryArtist = this.extractPrimaryArtist(artists);
    if (primaryArtist) {
      parts.push(primaryArtist);
    }

    // Add release/album title for context (helps with disambiguation)
    if (releaseTitle) {
      const normalizedRelease = this.normalizeTrackTitle(releaseTitle);
      if (normalizedRelease) {
        parts.push(normalizedRelease);
      }
    }

    // Add featuring artists if present (can help narrow search)
    const featuring = this.extractFeaturingArtists(trackTitle);
    if (featuring.length > 0) {
      parts.push(...featuring.slice(0, 2)); // Limit to first 2 featuring artists
    }

    return parts
      .filter(p => p.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build multiple query strategies for fallback searching
   *
   * Returns queries in priority order (most specific to most general)
   *
   * @example
   * buildQueryStrategies("Love Me Do", "The Beatles", "Please Please Me")
   * // Returns: [
   * //   "Love Me Do Beatles Please Please Me",
   * //   "Love Me Do Beatles",
   * //   "Love Me Do"
   * // ]
   */
  static buildQueryStrategies(
    trackTitle: string,
    artists: string,
    releaseTitle?: string
  ): string[] {
    const queries: string[] = [];

    const normalizedTrack = this.normalizeTrackTitle(trackTitle);
    const primaryArtist = this.extractPrimaryArtist(artists);
    const normalizedRelease = releaseTitle ? this.normalizeTrackTitle(releaseTitle) : '';

    // Strategy 1: Full context (track + artist + album)
    if (normalizedTrack && primaryArtist && normalizedRelease) {
      queries.push(`${normalizedTrack} ${primaryArtist} ${normalizedRelease}`);
    }

    // Strategy 2: Track + artist (no album)
    if (normalizedTrack && primaryArtist) {
      queries.push(`${normalizedTrack} ${primaryArtist}`);
    }

    // Strategy 3: Track only (for well-known tracks)
    if (normalizedTrack) {
      queries.push(normalizedTrack);
    }

    // Strategy 4: Track + album (for cases where artist might be misspelled)
    if (normalizedTrack && normalizedRelease) {
      queries.push(`${normalizedTrack} ${normalizedRelease}`);
    }

    // Deduplicate and filter empty queries
    return Array.from(new Set(queries))
      .filter(q => q.trim().length > 0)
      .map(q => q.replace(/\s+/g, ' ').trim());
  }

  /**
   * Calculate simple string similarity (0-1) for basic matching
   * Uses case-insensitive substring matching
   *
   * @returns Score from 0 (no match) to 1 (exact match)
   */
  static calculateBasicSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return 1.0;

    // One contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.8;
    }

    // Split into words and check overlap
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);

    const commonWords = words1.filter(w => words2.includes(w)).length;
    const totalWords = Math.max(words1.length, words2.length);

    if (totalWords === 0) return 0;

    // Return ratio of common words
    return commonWords / totalWords;
  }
}
