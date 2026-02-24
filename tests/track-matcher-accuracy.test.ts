/**
 * Fixture-based accuracy benchmark for TrackMatcher.
 *
 * Tests the matcher against known real-world track pairs to assert a minimum
 * match accuracy rate. This prevents regressions in algorithm changes from
 * silently reducing match quality.
 *
 * To add new test cases, edit tests/fixtures/track-match-fixtures.json.
 */
import { TrackMatcher, MatchCandidate } from '../src/services/track-matcher';
import fixtures from './fixtures/track-match-fixtures.json';

const MINIMUM_MATCH_ACCURACY = 0.75;      // ≥ 75% of "should match" cases must pass threshold
const MINIMUM_NONMATCH_ACCURACY = 0.80;   // ≥ 80% of "should NOT match" cases must stay below threshold
// Note: A case with an exact title match but different artist/duration (e.g. a cover song with
// identical title) can reach exactly the confidence threshold via title weight alone. This is an
// inherent ambiguity that the manual review mechanism exists to resolve.
const MATCH_THRESHOLD = TrackMatcher.getConfidenceThreshold();

interface Fixture {
  description: string;
  discogsTitle: string;
  discogsArtist: string;
  discogsDuration?: string;
  soundcloudTitle: string;
  soundcloudUsername: string;
  soundcloudDurationMs?: number;
  expectMatch: boolean;
}

describe('TrackMatcher accuracy benchmark', () => {
  const matchFixtures = (fixtures as Fixture[]).filter(f => f.expectMatch);
  const nonMatchFixtures = (fixtures as Fixture[]).filter(f => !f.expectMatch);

  function buildCandidate(f: Fixture): MatchCandidate {
    return {
      id: '1',
      title: f.soundcloudTitle,
      user: { username: f.soundcloudUsername },
      duration: f.soundcloudDurationMs,
    };
  }

  describe('Expected matches', () => {
    let passCount = 0;
    const failures: string[] = [];

    afterAll(() => {
      const total = matchFixtures.length;
      const rate = total > 0 ? passCount / total : 0;
      console.log(`\nMatch accuracy: ${passCount}/${total} (${(rate * 100).toFixed(1)}%) — threshold: ${(MINIMUM_MATCH_ACCURACY * 100).toFixed(0)}%`);
      expect(rate).toBeGreaterThanOrEqual(MINIMUM_MATCH_ACCURACY);
      if (failures.length > 0) {
        console.log('Failing cases:');
        failures.forEach(f => console.log(' -', f));
      }
    });

    matchFixtures.forEach((fixture) => {
      it(`should match: ${fixture.description}`, () => {
        const candidate = buildCandidate(fixture);
        const { confidence } = TrackMatcher.scoreMatch(
          fixture.discogsTitle,
          fixture.discogsArtist,
          fixture.discogsDuration || null,
          candidate
        );

        if (confidence >= MATCH_THRESHOLD) {
          passCount++;
        } else {
          failures.push(`"${fixture.discogsTitle}" → "${fixture.soundcloudTitle}" (${(confidence * 100).toFixed(0)}% < ${(MATCH_THRESHOLD * 100).toFixed(0)}%)`);
        }

        // Each case should be informatively logged but only the aggregate matters for pass/fail
        expect(confidence).toBeDefined();
      });
    });
  });

  describe('Expected non-matches', () => {
    let passCount = 0;
    const failures: string[] = [];

    afterAll(() => {
      const total = nonMatchFixtures.length;
      const rate = total > 0 ? passCount / total : 0;
      console.log(`\nNon-match accuracy: ${passCount}/${total} (${(rate * 100).toFixed(1)}%) — threshold: ${(MINIMUM_NONMATCH_ACCURACY * 100).toFixed(0)}%`);
      expect(rate).toBeGreaterThanOrEqual(MINIMUM_NONMATCH_ACCURACY);
      if (failures.length > 0) {
        console.log('False positive cases (wrongly matched):');
        failures.forEach(f => console.log(' -', f));
      }
    });

    nonMatchFixtures.forEach((fixture) => {
      it(`should NOT match: ${fixture.description}`, () => {
        const candidate = buildCandidate(fixture);
        const { confidence } = TrackMatcher.scoreMatch(
          fixture.discogsTitle,
          fixture.discogsArtist,
          fixture.discogsDuration || null,
          candidate
        );

        if (confidence < MATCH_THRESHOLD) {
          passCount++;
        } else {
          failures.push(`"${fixture.discogsTitle}" → "${fixture.soundcloudTitle}" false positive at ${(confidence * 100).toFixed(0)}%`);
        }

        expect(confidence).toBeDefined();
      });
    });
  });

  describe('findBestMatch with fixture candidates', () => {
    it('should pick the correct track when mixed with distractors', () => {
      const correct: MatchCandidate = {
        id: 'correct',
        title: 'Bohemian Rhapsody',
        user: { username: 'Queen' },
        duration: 354000,
      };
      const distractor1: MatchCandidate = {
        id: 'wrong1',
        title: 'We Will Rock You',
        user: { username: 'Queen' },
        duration: 122000,
      };
      const distractor2: MatchCandidate = {
        id: 'wrong2',
        title: 'Somebody to Love',
        user: { username: 'Queen' },
        duration: 298000,
      };

      const result = TrackMatcher.findBestMatch(
        'Bohemian Rhapsody',
        'Queen',
        '5:54',
        [distractor1, distractor2, correct]
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('correct');
      expect(result!.confidence).toBeGreaterThan(0.9);
    });

    it('should return null when all candidates are wrong', () => {
      const candidates: MatchCandidate[] = [
        { id: '1', title: 'We Will Rock You', user: { username: 'Queen' }, duration: 122000 },
        { id: '2', title: 'Somebody to Love', user: { username: 'Queen' }, duration: 298000 },
      ];

      const result = TrackMatcher.findBestMatch(
        'Bohemian Rhapsody',
        'Queen',
        '5:54',
        candidates
      );

      expect(result).toBeNull();
    });
  });
});
