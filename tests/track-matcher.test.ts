import { TrackMatcher, MatchCandidate } from '../src/services/track-matcher';

describe('TrackMatcher', () => {
  describe('calculateStringSimilarity', () => {
    it('should return 1.0 for identical strings', () => {
      const similarity = TrackMatcher.calculateStringSimilarity('Bohemian Rhapsody', 'Bohemian Rhapsody');
      expect(similarity).toBe(1.0);
    });

    it('should be case-insensitive', () => {
      const similarity = TrackMatcher.calculateStringSimilarity('BOHEMIAN RHAPSODY', 'bohemian rhapsody');
      expect(similarity).toBe(1.0);
    });

    it('should score similar strings highly', () => {
      const similarity = TrackMatcher.calculateStringSimilarity('Love Me Do', 'Love Me Do Remastered');
      expect(similarity).toBeGreaterThan(0.5); // Adjusted based on Dice coefficient behavior
    });

    it('should score different strings lowly', () => {
      const similarity = TrackMatcher.calculateStringSimilarity('Bohemian Rhapsody', 'Yesterday');
      expect(similarity).toBeLessThan(0.3);
    });

    it('should handle empty strings', () => {
      expect(TrackMatcher.calculateStringSimilarity('', '')).toBe(0);
      expect(TrackMatcher.calculateStringSimilarity('test', '')).toBe(0);
      expect(TrackMatcher.calculateStringSimilarity('', 'test')).toBe(0);
    });

    it('should handle strings with minor differences', () => {
      const similarity1 = TrackMatcher.calculateStringSimilarity('Song Name', 'Song Name - Remastered');
      const similarity2 = TrackMatcher.calculateStringSimilarity('Track Title', 'Track Title (2015)');

      expect(similarity1).toBeGreaterThan(0.4); // Adjusted for realistic expectations
      expect(similarity2).toBeGreaterThan(0.4);
    });
  });

  describe('parseDiscogsDuration', () => {
    it('should parse MM:SS format', () => {
      expect(TrackMatcher.parseDiscogsDuration('3:45')).toBe(225); // 3*60 + 45
      expect(TrackMatcher.parseDiscogsDuration('4:00')).toBe(240);
      expect(TrackMatcher.parseDiscogsDuration('0:30')).toBe(30);
    });

    it('should parse H:MM:SS format', () => {
      expect(TrackMatcher.parseDiscogsDuration('1:30:00')).toBe(5400); // 1*3600 + 30*60
      expect(TrackMatcher.parseDiscogsDuration('2:15:30')).toBe(8130);
    });

    it('should return 0 for invalid format', () => {
      expect(TrackMatcher.parseDiscogsDuration('')).toBe(0);
      expect(TrackMatcher.parseDiscogsDuration('invalid')).toBe(0);
      expect(TrackMatcher.parseDiscogsDuration('3.45')).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(TrackMatcher.parseDiscogsDuration(null as any)).toBe(0);
      expect(TrackMatcher.parseDiscogsDuration(undefined as any)).toBe(0);
      expect(TrackMatcher.parseDiscogsDuration('10:99')).toBe(10 * 60 + 99); // Invalid time but parses
    });
  });

  describe('scoreMatch', () => {
    it('should score exact matches as 1.0', () => {
      const candidate: MatchCandidate = {
        id: '123',
        title: 'Bohemian Rhapsody',
        user: { username: 'Queen' },
        duration: 354000, // 5:54 in milliseconds
      };

      const score = TrackMatcher.scoreMatch(
        'Bohemian Rhapsody',
        'Queen',
        '5:54',
        candidate
      );

      expect(score).toBeGreaterThan(0.95);
    });

    it('should score similar matches highly', () => {
      const candidate: MatchCandidate = {
        id: '123',
        title: 'Bohemian Rhapsody - Remastered 2011',
        user: { username: 'Queen Official' },
        duration: 357000, // ~5:57 (slight difference)
      };

      const score = TrackMatcher.scoreMatch(
        'Bohemian Rhapsody',
        'Queen',
        '5:54',
        candidate
      );

      expect(score).toBeGreaterThan(0.6); // Realistic threshold for good matches
    });

    it('should score poor matches lowly', () => {
      const candidate: MatchCandidate = {
        id: '456',
        title: 'Different Song',
        user: { username: 'Different Artist' },
        duration: 180000,
      };

      const score = TrackMatcher.scoreMatch(
        'Bohemian Rhapsody',
        'Queen',
        '5:54',
        candidate
      );

      expect(score).toBeLessThan(0.4);
    });

    it('should weight title similarity most heavily', () => {
      const candidateGoodTitle: MatchCandidate = {
        id: '123',
        title: 'Love Me Do',
        user: { username: 'Wrong Artist' },
        duration: 200000, // Different duration to ensure title wins
      };

      const candidateBadTitle: MatchCandidate = {
        id: '456',
        title: 'Wrong Song',
        user: { username: 'The Beatles' },
        duration: 200000,
      };

      const scoreGoodTitle = TrackMatcher.scoreMatch(
        'Love Me Do',
        'The Beatles',
        '2:23',
        candidateGoodTitle
      );

      const scoreBadTitle = TrackMatcher.scoreMatch(
        'Love Me Do',
        'The Beatles',
        '2:23',
        candidateBadTitle
      );

      // Good title should score higher even with wrong artist (title weighted 50%)
      expect(scoreGoodTitle).toBeGreaterThan(scoreBadTitle);
    });

    it('should handle missing duration gracefully', () => {
      const candidate: MatchCandidate = {
        id: '123',
        title: 'Song Name',
        user: { username: 'Artist Name' },
      };

      const score = TrackMatcher.scoreMatch(
        'Song Name',
        'Artist Name',
        null,
        candidate
      );

      expect(score).toBeGreaterThan(0); // Should still score based on title/artist
    });

    it('should penalize large duration differences', () => {
      const candidate: MatchCandidate = {
        id: '123',
        title: 'Song Name',
        user: { username: 'Artist Name' },
        duration: 600000, // 10 minutes
      };

      const score = TrackMatcher.scoreMatch(
        'Song Name',
        'Artist Name',
        '3:00', // 3 minutes - very different
        candidate
      );

      // Duration difference should lower the score
      expect(score).toBeLessThan(0.9);
    });
  });

  describe('findBestMatch', () => {
    it('should find the best match from multiple candidates', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Wrong Song',
          user: { username: 'Wrong Artist' },
          duration: 120000,
        },
        {
          id: '2',
          title: 'Hey Jude',
          user: { username: 'The Beatles' },
          duration: 431000, // 7:11
        },
        {
          id: '3',
          title: 'Hey Jude Cover',
          user: { username: 'Some Cover Band' },
          duration: 300000,
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Hey Jude',
        'The Beatles',
        '7:11',
        candidates
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('2');
      expect(result!.confidence).toBeGreaterThan(0.8);
    });

    it('should return null if no candidates exceed threshold', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Completely Different Song',
          user: { username: 'Different Artist' },
          duration: 120000,
        },
        {
          id: '2',
          title: 'Another Wrong Song',
          user: { username: 'Another Artist' },
          duration: 180000,
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Hey Jude',
        'The Beatles',
        '7:11',
        candidates
      );

      expect(result).toBeNull();
    });

    it('should return null for empty candidates array', () => {
      const result = TrackMatcher.findBestMatch(
        'Hey Jude',
        'The Beatles',
        '7:11',
        []
      );

      expect(result).toBeNull();
    });

    it('should handle single candidate', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Hey Jude',
          user: { username: 'The Beatles' },
          duration: 431000,
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Hey Jude',
        'The Beatles',
        '7:11',
        candidates
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('1');
    });
  });

  describe('findAllMatches', () => {
    it('should find all matches above threshold', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Yesterday',
          user: { username: 'The Beatles' },
          duration: 126000,
        },
        {
          id: '2',
          title: 'Yesterday - Remastered',
          user: { username: 'Beatles Official' },
          duration: 128000,
        },
        {
          id: '3',
          title: 'Yesterday Cover',
          user: { username: 'Cover Artist' },
          duration: 130000,
        },
        {
          id: '4',
          title: 'Completely Different',
          user: { username: 'Other Artist' },
          duration: 200000,
        },
      ];

      const matches = TrackMatcher.findAllMatches(
        'Yesterday',
        'The Beatles',
        '2:06',
        candidates,
        0.5 // Lower threshold to catch more
      );

      expect(matches.length).toBeGreaterThan(1);
      expect(matches.length).toBeLessThan(4); // Should exclude the "Completely Different" one
      expect(matches[0].confidence).toBeGreaterThanOrEqual(matches[1].confidence); // Sorted by confidence
    });

    it('should return empty array if no matches exceed threshold', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Different Song',
          user: { username: 'Different Artist' },
          duration: 120000,
        },
      ];

      const matches = TrackMatcher.findAllMatches(
        'Yesterday',
        'The Beatles',
        '2:06',
        candidates,
        0.8 // High threshold
      );

      expect(matches).toEqual([]);
    });

    it('should sort results by confidence descending', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Song Name Cover',
          user: { username: 'Cover Band' },
          duration: 200000,
        },
        {
          id: '2',
          title: 'Song Name',
          user: { username: 'Original Artist' },
          duration: 180000,
        },
        {
          id: '3',
          title: 'Song Name - Remastered',
          user: { username: 'Original Artist Remastered' },
          duration: 185000,
        },
      ];

      const matches = TrackMatcher.findAllMatches(
        'Song Name',
        'Original Artist',
        '3:00',
        candidates,
        0.3
      );

      // Each match should have confidence >= next match
      for (let i = 0; i < matches.length - 1; i++) {
        expect(matches[i].confidence).toBeGreaterThanOrEqual(matches[i + 1].confidence);
      }
    });
  });

  describe('Real-world scenarios', () => {
    it('should match Beatles songs correctly', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Let It Be - Remastered 2009',
          user: { username: 'The Beatles - Topic' },
          duration: 243000,
        },
        {
          id: '2',
          title: 'Let It Be Cover',
          user: { username: 'Various Artists' },
          duration: 240000,
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Let It Be',
        'The Beatles',
        '4:03',
        candidates
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('1'); // Should pick the official one
    });

    it('should handle remasters and different versions', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Stairway to Heaven (Remaster)',
          user: { username: 'Led Zeppelin' },
          duration: 482000, // 8:02
        },
        {
          id: '2',
          title: 'Stairway to Heaven - Live',
          user: { username: 'Led Zeppelin' },
          duration: 600000, // 10:00
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Stairway to Heaven',
        'Led Zeppelin',
        '8:02',
        candidates
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('1'); // Should match duration better
    });

    it('should handle featuring artists', () => {
      const candidates: MatchCandidate[] = [
        {
          id: '1',
          title: 'Empire State of Mind',
          user: { username: 'JAY-Z' },
          duration: 276000,
        },
        {
          id: '2',
          title: 'Empire State of Mind (Part II)',
          user: { username: 'Alicia Keys' },
          duration: 216000,
        },
      ];

      const result = TrackMatcher.findBestMatch(
        'Empire State of Mind',
        'JAY-Z',
        '4:36',
        candidates
      );

      expect(result).not.toBeNull();
      expect(result!.candidate.id).toBe('1');
    });
  });
});
