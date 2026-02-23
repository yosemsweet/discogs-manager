/**
 * TrackMatcher - Advanced track matching service with fuzzy string matching
 *
 * Provides sophisticated matching algorithms to compare expected tracks (from Discogs)
 * with candidate tracks (from SoundCloud search results).
 *
 * Uses multiple scoring factors:
 * - Title similarity (Dice coefficient + Levenshtein distance)
 * - Artist similarity
 * - Duration matching
 *
 * Returns confidence scores (0-1) for each match.
 */

export interface MatchCandidate {
  id: string;
  title: string;
  user?: { username: string };
  duration?: number; // Duration in milliseconds
}

export interface MatchResult {
  trackId: string;
  discogsId: number;
  confidence: number;
  matchedTitle: string;
  matchedArtist?: string;
}

export class TrackMatcher {
  // Configurable thresholds
  private static readonly CONFIDENCE_THRESHOLD = 0.6;
  private static readonly TITLE_WEIGHT = 0.5;
  private static readonly ARTIST_WEIGHT = 0.3;
  private static readonly DURATION_WEIGHT = 0.2;

  /**
   * Calculate Dice coefficient (Sørensen–Dice coefficient) between two strings
   * More accurate than simple substring matching for fuzzy comparison
   *
   * @returns Score from 0 to 1 (1 = identical)
   */
  private static diceCoefficient(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    // Generate bigrams (2-character pairs)
    const bigrams1 = new Set<string>();
    const bigrams2 = new Set<string>();

    for (let i = 0; i < s1.length - 1; i++) {
      bigrams1.add(s1.substring(i, i + 2));
    }

    for (let i = 0; i < s2.length - 1; i++) {
      bigrams2.add(s2.substring(i, i + 2));
    }

    // Calculate intersection
    let intersection = 0;
    for (const bigram of bigrams1) {
      if (bigrams2.has(bigram)) {
        intersection++;
      }
    }

    // Dice coefficient: 2 * |intersection| / (|set1| + |set2|)
    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

  /**
   * Calculate Levenshtein distance (edit distance) between two strings
   * Lower is better - represents minimum number of edits needed to transform one string to another
   *
   * @returns Number of edits required
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    if (!str1 || !str2) return Math.max(str1?.length || 0, str2?.length || 0);

    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  /**
   * Calculate normalized Levenshtein similarity (0-1 scale)
   * Converts edit distance to similarity score
   *
   * @returns Score from 0 to 1 (1 = identical)
   */
  private static levenshteinSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);

    return maxLength > 0 ? 1 - (distance / maxLength) : 0;
  }

  /**
   * Calculate combined string similarity using multiple algorithms
   * Combines Dice coefficient and Levenshtein similarity for robust matching
   *
   * @returns Score from 0 to 1 (1 = identical)
   */
  static calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1.toLowerCase() === str2.toLowerCase()) return 1.0;

    // Use both algorithms and average for robustness
    const dice = this.diceCoefficient(str1, str2);
    const levenshtein = this.levenshteinSimilarity(str1, str2);

    // Weighted average (Dice is slightly more reliable for similar strings)
    return (dice * 0.6) + (levenshtein * 0.4);
  }

  /**
   * Parse Discogs duration format (e.g., "3:45" → 225 seconds)
   *
   * @param duration - Duration string in MM:SS or H:MM:SS format
   * @returns Duration in seconds, or 0 if invalid
   */
  static parseDiscogsDuration(duration: string): number {
    if (!duration || typeof duration !== 'string') return 0;

    const parts = duration.split(':').map(p => parseInt(p.trim(), 10));

    if (parts.some(isNaN)) return 0;

    if (parts.length === 2) {
      // MM:SS format
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // H:MM:SS format
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return 0;
  }

  /**
   * Score a candidate track against the expected track using multiple factors
   *
   * @param expectedTitle - Expected track title from Discogs
   * @param expectedArtist - Expected artist name from Discogs
   * @param expectedDuration - Expected duration in "MM:SS" format (or null)
   * @param candidate - Candidate track from SoundCloud search results
   * @returns Confidence score from 0 to 1
   */
  static scoreMatch(
    expectedTitle: string,
    expectedArtist: string,
    expectedDuration: string | null,
    candidate: MatchCandidate
  ): number {
    let score = 0;
    let totalWeight = 0;

    // 1. Title similarity (most important)
    if (expectedTitle && candidate.title) {
      const titleSimilarity = this.calculateStringSimilarity(
        expectedTitle,
        candidate.title
      );
      score += titleSimilarity * this.TITLE_WEIGHT;
      totalWeight += this.TITLE_WEIGHT;
    }

    // 2. Artist similarity (important for disambiguation)
    if (expectedArtist && candidate.user?.username) {
      const artistSimilarity = this.calculateStringSimilarity(
        expectedArtist,
        candidate.user.username
      );
      score += artistSimilarity * this.ARTIST_WEIGHT;
      totalWeight += this.ARTIST_WEIGHT;
    }

    // 3. Duration matching (helps validate correct version)
    if (expectedDuration && candidate.duration) {
      const expectedSeconds = this.parseDiscogsDuration(expectedDuration);
      const candidateSeconds = Math.floor(candidate.duration / 1000);

      if (expectedSeconds > 0 && candidateSeconds > 0) {
        // Calculate duration difference as percentage
        const variance = Math.abs(expectedSeconds - candidateSeconds) / expectedSeconds;

        // Allow up to 10% variance (accounts for different versions, fades, etc.)
        // Score: 1.0 for exact match, 0.0 for >10% difference
        const durationScore = Math.max(0, 1 - (variance * 10));

        score += durationScore * this.DURATION_WEIGHT;
        totalWeight += this.DURATION_WEIGHT;
      }
    }

    // Normalize score to 0-1 range based on weights used
    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Find the best matching candidate from a list of search results
   *
   * @param expectedTitle - Expected track title
   * @param expectedArtist - Expected artist name
   * @param expectedDuration - Expected duration (optional)
   * @param candidates - List of candidate tracks from search
   * @returns Best match with confidence score, or null if no good match found
   */
  static findBestMatch(
    expectedTitle: string,
    expectedArtist: string,
    expectedDuration: string | null,
    candidates: MatchCandidate[]
  ): { candidate: MatchCandidate; confidence: number } | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    let bestCandidate: MatchCandidate | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const score = this.scoreMatch(
        expectedTitle,
        expectedArtist,
        expectedDuration,
        candidate
      );

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    // Only return match if confidence exceeds threshold
    if (bestScore >= this.CONFIDENCE_THRESHOLD && bestCandidate) {
      return {
        candidate: bestCandidate,
        confidence: bestScore,
      };
    }

    return null;
  }

  /**
   * Find all matches above a certain confidence threshold
   * Useful for manual review or showing alternative matches
   *
   * @param expectedTitle - Expected track title
   * @param expectedArtist - Expected artist name
   * @param expectedDuration - Expected duration (optional)
   * @param candidates - List of candidate tracks
   * @param threshold - Minimum confidence threshold (default: 0.6)
   * @returns Array of matches sorted by confidence (descending)
   */
  static findAllMatches(
    expectedTitle: string,
    expectedArtist: string,
    expectedDuration: string | null,
    candidates: MatchCandidate[],
    threshold: number = 0.6
  ): Array<{ candidate: MatchCandidate; confidence: number }> {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    const matches: Array<{ candidate: MatchCandidate; confidence: number }> = [];

    for (const candidate of candidates) {
      const score = this.scoreMatch(
        expectedTitle,
        expectedArtist,
        expectedDuration,
        candidate
      );

      if (score >= threshold) {
        matches.push({
          candidate,
          confidence: score,
        });
      }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get confidence threshold used for accepting matches
   */
  static getConfidenceThreshold(): number {
    return this.CONFIDENCE_THRESHOLD;
  }

  /**
   * Set confidence threshold (for testing or tuning)
   * @param threshold - New threshold (0-1)
   */
  static setConfidenceThreshold(threshold: number): void {
    if (threshold >= 0 && threshold <= 1) {
      (this as any).CONFIDENCE_THRESHOLD = threshold;
    }
  }
}
