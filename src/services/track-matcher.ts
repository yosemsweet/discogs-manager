/**
 * TrackMatcher - Advanced track matching service with fuzzy string matching
 *
 * Provides sophisticated matching algorithms to compare expected tracks (from Discogs)
 * with candidate tracks (from SoundCloud search results).
 *
 * Uses multiple scoring factors:
 * - Title similarity (Dice coefficient + Levenshtein distance)
 * - Artist similarity (note: SoundCloud user.username is the uploader handle, not the
 *   canonical artist name — this dimension is a weaker signal than title)
 * - Duration matching
 *
 * Returns confidence scores (0-1) for each match.
 */
import { QueryNormalizer } from '../utils/query-normalizer';

export interface MatchCandidate {
  id: string;
  title: string;
  user?: { username: string };
  duration?: number; // Duration in milliseconds
}

export interface MatchScoreBreakdown {
  titleScore: number;
  artistScore: number;
  durationScore: number;
  titleWeight: number;
  artistWeight: number;
  durationWeight: number;
  weightsUsed: number;
}

export interface MatchResult {
  trackId: string;
  discogsId: number;
  confidence: number;
  matchedTitle: string;
  matchedArtist?: string;
  scoreBreakdown?: MatchScoreBreakdown;
}

export class TrackMatcher {
  // Configurable thresholds (non-readonly so setConfidenceThreshold works without casting)
  private static CONFIDENCE_THRESHOLD = 0.6;
  // Title is the strongest signal; artist (user.username = uploader handle) is weaker
  private static readonly TITLE_WEIGHT = 0.6;
  private static readonly ARTIST_WEIGHT = 0.2;
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

    // Generate bigrams (2-character pairs) as multisets (Map counts occurrences)
    // Using Map instead of Set preserves repeated bigrams, e.g. "aaa" → {"aa": 2}
    const buildBigrams = (s: string): Map<string, number> => {
      const map = new Map<string, number>();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.substring(i, i + 2);
        map.set(bg, (map.get(bg) || 0) + 1);
      }
      return map;
    };

    const bigrams1 = buildBigrams(s1);
    const bigrams2 = buildBigrams(s2);

    // Total bigram counts
    const total1 = Array.from(bigrams1.values()).reduce((a, b) => a + b, 0);
    const total2 = Array.from(bigrams2.values()).reduce((a, b) => a + b, 0);

    if (total1 === 0 || total2 === 0) return 0;

    // Intersection: sum of min(count in s1, count in s2) for each bigram
    let intersection = 0;
    for (const [bigram, count1] of bigrams1) {
      const count2 = bigrams2.get(bigram) || 0;
      intersection += Math.min(count1, count2);
    }

    // Dice coefficient: 2 * |intersection| / (|multiset1| + |multiset2|)
    return (2 * intersection) / (total1 + total2);
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
   * Score a candidate track against the expected track using multiple factors.
   *
   * Normalizes both Discogs and SoundCloud strings before comparison so that
   * parentheticals like "(Remastered 2009)" or "[feat. X]" don't deflate scores.
   *
   * Note: candidate.user.username is the SoundCloud uploader handle, NOT a canonical
   * artist name. Artist similarity is a weaker signal and weighted accordingly (0.2).
   *
   * @param expectedTitle - Expected track title from Discogs
   * @param expectedArtist - Expected artist name from Discogs
   * @param expectedDuration - Expected duration in "MM:SS" format (or null)
   * @param candidate - Candidate track from SoundCloud search results
   * @returns Object with confidence (0-1) and per-dimension score breakdown
   */
  static scoreMatch(
    expectedTitle: string,
    expectedArtist: string,
    expectedDuration: string | null,
    candidate: MatchCandidate
  ): { confidence: number; breakdown: MatchScoreBreakdown } {
    let score = 0;
    let totalWeight = 0;

    let titleScore = 0;
    let artistScore = 0;
    let durationScore = 0;

    // Normalize both sides before comparison so "(Remastered)" etc. don't deflate scores
    const normExpectedTitle = QueryNormalizer.normalizeTrackTitle(expectedTitle);
    const normCandidateTitle = candidate.title
      ? QueryNormalizer.normalizeTrackTitle(candidate.title)
      : '';

    // 1. Title similarity (strongest signal)
    if (normExpectedTitle && normCandidateTitle) {
      titleScore = this.calculateStringSimilarity(normExpectedTitle, normCandidateTitle);
      score += titleScore * this.TITLE_WEIGHT;
      totalWeight += this.TITLE_WEIGHT;
    }

    // 2. Artist similarity (weaker signal: user.username is the uploader handle)
    if (expectedArtist && candidate.user?.username) {
      const normExpectedArtist = QueryNormalizer.normalizeArtistName(expectedArtist);
      const normCandidateUser = QueryNormalizer.normalizeArtistName(candidate.user.username);
      artistScore = this.calculateStringSimilarity(normExpectedArtist, normCandidateUser);
      score += artistScore * this.ARTIST_WEIGHT;
      totalWeight += this.ARTIST_WEIGHT;
    }

    // 3. Duration matching (helps validate correct version/edit)
    if (expectedDuration && candidate.duration) {
      const expectedSeconds = this.parseDiscogsDuration(expectedDuration);
      const candidateSeconds = Math.floor(candidate.duration / 1000);

      if (expectedSeconds > 0 && candidateSeconds > 0) {
        // Calculate duration difference as a fraction of expected duration
        const variance = Math.abs(expectedSeconds - candidateSeconds) / expectedSeconds;

        // Allow up to 20% variance (accounts for different edits, fades, intros)
        // Score: 1.0 for exact match, 0.0 for ≥20% difference (linear)
        durationScore = Math.max(0, 1 - (variance * 5));

        score += durationScore * this.DURATION_WEIGHT;
        totalWeight += this.DURATION_WEIGHT;
      }
    }

    // Normalize score to 0-1 based on which dimensions were available
    const confidence = totalWeight > 0 ? score / totalWeight : 0;

    const breakdown: MatchScoreBreakdown = {
      titleScore,
      artistScore,
      durationScore,
      titleWeight: this.TITLE_WEIGHT,
      artistWeight: this.ARTIST_WEIGHT,
      durationWeight: this.DURATION_WEIGHT,
      weightsUsed: totalWeight,
    };

    return { confidence, breakdown };
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
  ): { candidate: MatchCandidate; confidence: number; breakdown: MatchScoreBreakdown } | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    let bestCandidate: MatchCandidate | null = null;
    let bestScore = 0;
    let bestBreakdown: MatchScoreBreakdown | null = null;

    for (const candidate of candidates) {
      const { confidence, breakdown } = this.scoreMatch(
        expectedTitle,
        expectedArtist,
        expectedDuration,
        candidate
      );

      if (confidence > bestScore) {
        bestScore = confidence;
        bestCandidate = candidate;
        bestBreakdown = breakdown;
      }
    }

    // Only return match if confidence exceeds threshold
    if (bestScore >= this.CONFIDENCE_THRESHOLD && bestCandidate && bestBreakdown) {
      return {
        candidate: bestCandidate,
        confidence: bestScore,
        breakdown: bestBreakdown,
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
  ): Array<{ candidate: MatchCandidate; confidence: number; breakdown: MatchScoreBreakdown }> {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    const matches: Array<{ candidate: MatchCandidate; confidence: number; breakdown: MatchScoreBreakdown }> = [];

    for (const candidate of candidates) {
      const { confidence, breakdown } = this.scoreMatch(
        expectedTitle,
        expectedArtist,
        expectedDuration,
        candidate
      );

      if (confidence >= threshold) {
        matches.push({ candidate, confidence, breakdown });
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
      this.CONFIDENCE_THRESHOLD = threshold;
    }
  }
}
