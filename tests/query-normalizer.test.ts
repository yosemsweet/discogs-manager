import { QueryNormalizer } from '../src/utils/query-normalizer';

describe('QueryNormalizer', () => {
  describe('normalizeTrackTitle', () => {
    it('should handle basic titles unchanged', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Love Me Do')).toBe('Love Me Do');
      expect(QueryNormalizer.normalizeTrackTitle('Yesterday')).toBe('Yesterday');
    });

    it('should remove remaster parentheticals', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (Remastered)')).toBe('Song Name');
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (Remastered 2009)')).toBe('Song Name');
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (2015 Remaster)')).toBe('Song Name');
    });

    it('should remove remix parentheticals', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (Remix)')).toBe('Song Name');
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (DJ Remix)')).toBe('Song Name');
      expect(QueryNormalizer.normalizeTrackTitle('Song Name (Radio Edit)')).toBe('Song Name');
    });

    it('should remove featuring from title', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song (feat. Artist)')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song [ft. Artist]')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song featuring Artist')).toBe('Song');
    });

    it('should remove version/edit parentheticals', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song (Album Version)')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song (Radio Edit)')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song (Clean Version)')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song (Explicit)')).toBe('Song');
    });

    it('should handle square brackets', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song [Bonus Track]')).toBe('Song');
      expect(QueryNormalizer.normalizeTrackTitle('Song [Live]')).toBe('Song');
    });

    it('should preserve apostrophes and hyphens', () => {
      expect(QueryNormalizer.normalizeTrackTitle("Don't Stop")).toBe("Don't Stop");
      expect(QueryNormalizer.normalizeTrackTitle('Hip-Hop Song')).toBe('Hip-Hop Song');
    });

    it('should normalize whitespace', () => {
      expect(QueryNormalizer.normalizeTrackTitle('Song   Name')).toBe('Song Name');
      expect(QueryNormalizer.normalizeTrackTitle('  Song Name  ')).toBe('Song Name');
    });

    it('should handle empty or invalid input', () => {
      expect(QueryNormalizer.normalizeTrackTitle('')).toBe('');
      expect(QueryNormalizer.normalizeTrackTitle('   ')).toBe('');
      expect(QueryNormalizer.normalizeTrackTitle(null as any)).toBe('');
      expect(QueryNormalizer.normalizeTrackTitle(undefined as any)).toBe('');
    });

    it('should handle complex real-world examples', () => {
      expect(
        QueryNormalizer.normalizeTrackTitle('Hey Jude (2009 Remaster) [feat. Paul McCartney]')
      ).toBe('Hey Jude');

      expect(
        QueryNormalizer.normalizeTrackTitle('Bohemian Rhapsody (Remastered 2011)')
      ).toBe('Bohemian Rhapsody');

      expect(
        QueryNormalizer.normalizeTrackTitle('Stairway to Heaven [Live] (Remastered)')
      ).toBe('Stairway to Heaven');
    });
  });

  describe('normalizeArtistName', () => {
    it('should handle basic artist names unchanged', () => {
      expect(QueryNormalizer.normalizeArtistName('The Beatles')).toBe('Beatles');
      expect(QueryNormalizer.normalizeArtistName('Madonna')).toBe('Madonna');
    });

    it('should remove "The" prefix', () => {
      expect(QueryNormalizer.normalizeArtistName('The Rolling Stones')).toBe('Rolling Stones');
      expect(QueryNormalizer.normalizeArtistName('the beatles')).toBe('beatles');
    });

    it('should normalize ampersands', () => {
      expect(QueryNormalizer.normalizeArtistName('Simon & Garfunkel')).toBe('Simon Garfunkel');
      expect(QueryNormalizer.normalizeArtistName('Artist1 & Artist2')).toBe('Artist1 Artist2');
    });

    it('should normalize "and"', () => {
      expect(QueryNormalizer.normalizeArtistName('Artist1 and Artist2')).toBe('Artist1 Artist2');
      expect(QueryNormalizer.normalizeArtistName('Artist1 AND Artist2')).toBe('Artist1 Artist2');
    });

    it('should remove featuring syntax', () => {
      expect(QueryNormalizer.normalizeArtistName('Artist feat. Guest')).toBe('Artist Guest');
      expect(QueryNormalizer.normalizeArtistName('Artist ft. Guest')).toBe('Artist Guest');
      expect(QueryNormalizer.normalizeArtistName('Artist featuring Guest')).toBe('Artist Guest');
    });

    it('should normalize whitespace', () => {
      expect(QueryNormalizer.normalizeArtistName('Artist   Name')).toBe('Artist Name');
      expect(QueryNormalizer.normalizeArtistName('  Artist Name  ')).toBe('Artist Name');
    });

    it('should handle empty or invalid input', () => {
      expect(QueryNormalizer.normalizeArtistName('')).toBe('');
      expect(QueryNormalizer.normalizeArtistName('   ')).toBe('');
      expect(QueryNormalizer.normalizeArtistName(null as any)).toBe('');
    });
  });

  describe('extractPrimaryArtist', () => {
    it('should extract primary artist before featuring', () => {
      expect(QueryNormalizer.extractPrimaryArtist('Main Artist feat. Guest')).toBe('Main Artist');
      expect(QueryNormalizer.extractPrimaryArtist('Main Artist ft. Guest')).toBe('Main Artist');
      expect(QueryNormalizer.extractPrimaryArtist('Main Artist featuring Guest')).toBe('Main Artist');
    });

    it('should return normalized artist if no featuring', () => {
      expect(QueryNormalizer.extractPrimaryArtist('The Beatles')).toBe('Beatles');
      expect(QueryNormalizer.extractPrimaryArtist('Madonna')).toBe('Madonna');
    });

    it('should handle empty input', () => {
      expect(QueryNormalizer.extractPrimaryArtist('')).toBe('');
      expect(QueryNormalizer.extractPrimaryArtist(null as any)).toBe('');
    });
  });

  describe('extractFeaturingArtists', () => {
    it('should extract featuring artists from parentheses', () => {
      const result = QueryNormalizer.extractFeaturingArtists('Song (feat. Artist One)');
      expect(result).toEqual(['Artist One']);
    });

    it('should extract multiple featuring artists', () => {
      const result = QueryNormalizer.extractFeaturingArtists('Song (feat. Artist One & Artist Two)');
      expect(result).toHaveLength(2);
      expect(result).toContain('Artist One');
      expect(result).toContain('Artist Two');
    });

    it('should extract from brackets', () => {
      const result = QueryNormalizer.extractFeaturingArtists('Song [ft. Guest Artist]');
      expect(result).toEqual(['Guest Artist']);
    });

    it('should handle "featuring" spelling', () => {
      const result = QueryNormalizer.extractFeaturingArtists('Song (featuring Artist)');
      expect(result).toEqual(['Artist']);
    });

    it('should return empty array if no featuring artists', () => {
      expect(QueryNormalizer.extractFeaturingArtists('Regular Song')).toEqual([]);
      expect(QueryNormalizer.extractFeaturingArtists('')).toEqual([]);
    });

    it('should handle comma-separated artists', () => {
      const result = QueryNormalizer.extractFeaturingArtists('Song (feat. Artist1, Artist2)');
      expect(result).toHaveLength(2);
    });
  });

  describe('buildSearchQuery', () => {
    it('should build basic query with track and artist', () => {
      const query = QueryNormalizer.buildSearchQuery('Love Me Do', 'The Beatles');
      expect(query).toBe('Love Me Do Beatles');
    });

    it('should include release title when provided', () => {
      const query = QueryNormalizer.buildSearchQuery(
        'Love Me Do',
        'The Beatles',
        'Please Please Me'
      );
      expect(query).toBe('Love Me Do Beatles Please Please Me');
    });

    it('should normalize all components', () => {
      const query = QueryNormalizer.buildSearchQuery(
        'Song (Remastered)',
        'The Beatles & Friends',
        'Album Name [Deluxe Edition]'
      );
      expect(query).toBe('Song Beatles Friends Album Name');
    });

    it('should handle missing artist', () => {
      const query = QueryNormalizer.buildSearchQuery('Song Name', '');
      expect(query).toBe('Song Name');
    });

    it('should handle missing release', () => {
      const query = QueryNormalizer.buildSearchQuery('Song Name', 'Artist Name', '');
      expect(query).toBe('Song Name Artist Name');
    });

    it('should include featuring artists', () => {
      const query = QueryNormalizer.buildSearchQuery(
        'Song (feat. Guest1 & Guest2)',
        'Main Artist',
        'Album'
      );
      // Should include main artist and up to 2 featuring artists
      expect(query).toContain('Song');
      expect(query).toContain('Main Artist');
      expect(query).toContain('Album');
    });

    it('should handle real-world example', () => {
      const query = QueryNormalizer.buildSearchQuery(
        'Bohemian Rhapsody (2011 Remaster)',
        'Queen',
        'A Night at the Opera [Deluxe Edition]'
      );
      expect(query).toBe('Bohemian Rhapsody Queen A Night at the Opera');
    });

    it('should normalize whitespace in final query', () => {
      const query = QueryNormalizer.buildSearchQuery('Song', 'Artist   Name', 'Album');
      expect(query).not.toContain('  ');
    });
  });

  describe('buildQueryStrategies', () => {
    it('should build multiple strategies in priority order', () => {
      const strategies = QueryNormalizer.buildQueryStrategies(
        'Love Me Do',
        'The Beatles',
        'Please Please Me'
      );

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies[0]).toBe('Love Me Do Beatles Please Please Me'); // Full context
      expect(strategies).toContain('Love Me Do Beatles'); // Track + artist
      expect(strategies).toContain('Love Me Do'); // Track only
    });

    it('should deduplicate strategies', () => {
      const strategies = QueryNormalizer.buildQueryStrategies('Song', 'Artist', '');

      // Should not have duplicates
      const unique = new Set(strategies);
      expect(unique.size).toBe(strategies.length);
    });

    it('should handle missing release title', () => {
      const strategies = QueryNormalizer.buildQueryStrategies('Song', 'Artist');

      expect(strategies).toContain('Song Artist');
      expect(strategies).toContain('Song');
    });

    it('should filter empty queries', () => {
      const strategies = QueryNormalizer.buildQueryStrategies('Song', '', '');

      expect(strategies).toContain('Song');
      expect(strategies.every(s => s.trim().length > 0)).toBe(true);
    });

    it('should generate valid strategies for complex input', () => {
      const strategies = QueryNormalizer.buildQueryStrategies(
        'Hey Jude (Remastered)',
        'The Beatles',
        'Past Masters'
      );

      expect(strategies).toContain('Hey Jude Beatles Past Masters');
      expect(strategies).toContain('Hey Jude Beatles');
      expect(strategies).toContain('Hey Jude');
    });
  });

  describe('calculateBasicSimilarity', () => {
    it('should return 1.0 for exact matches', () => {
      expect(QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'Love Me Do')).toBe(1.0);
    });

    it('should return 1.0 for case-insensitive exact matches', () => {
      expect(QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'love me do')).toBe(1.0);
    });

    it('should return 0.8 for substring matches', () => {
      expect(QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'Love Me Do Remastered')).toBe(0.8);
      expect(QueryNormalizer.calculateBasicSimilarity('Remastered Love Me Do', 'Love Me Do')).toBe(0.8);
    });

    it('should return score based on word overlap', () => {
      const score = QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'Love Me');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1.0);
    });

    it('should return 0 for completely different strings', () => {
      const score = QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'Yesterday');
      expect(score).toBe(0);
    });

    it('should handle empty strings', () => {
      expect(QueryNormalizer.calculateBasicSimilarity('', '')).toBe(0);
      expect(QueryNormalizer.calculateBasicSimilarity('Song', '')).toBe(0);
      expect(QueryNormalizer.calculateBasicSimilarity('', 'Song')).toBe(0);
    });

    it('should be case-insensitive', () => {
      const score1 = QueryNormalizer.calculateBasicSimilarity('LOVE ME DO', 'love me do');
      const score2 = QueryNormalizer.calculateBasicSimilarity('Love Me Do', 'love me do');
      expect(score1).toBe(score2);
      expect(score1).toBe(1.0);
    });

    it('should handle real-world examples', () => {
      // Good match
      const good = QueryNormalizer.calculateBasicSimilarity(
        'Bohemian Rhapsody',
        'Bohemian Rhapsody - Remastered'
      );
      expect(good).toBeGreaterThan(0.5);

      // Poor match
      const poor = QueryNormalizer.calculateBasicSimilarity(
        'Bohemian Rhapsody',
        'We Are The Champions'
      );
      expect(poor).toBeLessThan(0.3);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle typical workflow for Beatles song', () => {
      const trackTitle = 'Hey Jude (2015 Remaster)';
      const artist = 'The Beatles';
      const album = 'Past Masters [Remastered]';

      const query = QueryNormalizer.buildSearchQuery(trackTitle, artist, album);
      expect(query).toBe('Hey Jude Beatles Past Masters');

      const strategies = QueryNormalizer.buildQueryStrategies(trackTitle, artist, album);
      expect(strategies).toContain('Hey Jude Beatles Past Masters');
      expect(strategies).toContain('Hey Jude Beatles');
      expect(strategies).toContain('Hey Jude');
    });

    it('should handle featuring artists correctly', () => {
      const trackTitle = 'Song Name (feat. Guest Artist)';
      const artist = 'Main Artist';
      const album = 'Album Name';

      const query = QueryNormalizer.buildSearchQuery(trackTitle, artist, album);
      expect(query).toContain('Song Name');
      expect(query).toContain('Main Artist');
      expect(query).toContain('Album Name');

      const featuring = QueryNormalizer.extractFeaturingArtists(trackTitle);
      expect(featuring).toContain('Guest Artist');
    });

    it('should handle Various Artists compilation', () => {
      const trackTitle = 'Individual Song';
      const artist = 'Specific Artist';
      const album = 'Various Artists - Greatest Hits';

      const primaryArtist = QueryNormalizer.extractPrimaryArtist(artist);
      expect(primaryArtist).toBe('Specific Artist');

      const query = QueryNormalizer.buildSearchQuery(trackTitle, artist, album);
      expect(query).toContain('Individual Song');
      expect(query).toContain('Specific Artist');
    });
  });
});
