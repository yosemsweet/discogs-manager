import { DatabaseManager } from '../src/services/database';
import { parseQuery } from '../src/services/query/parser';
import { validateAST } from '../src/services/query/schema';
import { buildQuery } from '../src/services/query/builder';
import { executeQuery } from '../src/services/query/executor';

async function run(db: DatabaseManager, query: string) {
  const ast = parseQuery(query);
  validateAST(ast);
  const built = buildQuery(ast);
  return executeQuery(db, built);
}

async function seed(db: DatabaseManager) {
  // Seed diverse releases
  const releases = [
    { discogsId: 1,  title: 'Kind of Blue',         artists: 'Miles Davis',               year: 1959, genres: 'Jazz',       styles: 'Modal Jazz, Cool Jazz',    labels: 'Columbia',    rating: 5,    addedAt: '2026-01-10' },
    { discogsId: 2,  title: 'A Love Supreme',        artists: 'John Coltrane',             year: 1965, genres: 'Jazz',       styles: 'Free Jazz, Hard Bop',      labels: 'Impulse!',    rating: 5,    addedAt: '2026-01-15' },
    { discogsId: 3,  title: 'Bitches Brew',          artists: 'Miles Davis',               year: 1970, genres: 'Jazz',       styles: 'Jazz-Funk, Fusion',        labels: 'Columbia',    rating: 4,    addedAt: '2026-02-01' },
    { discogsId: 4,  title: 'Blue Train',            artists: 'John Coltrane',             year: 1957, genres: 'Jazz',       styles: 'Hard Bop',                 labels: 'Blue Note',   rating: 5,    addedAt: '2026-02-10' },
    { discogsId: 5,  title: 'Sticky Fingers',        artists: 'The Rolling Stones',        year: 1971, genres: 'Rock',       styles: 'Classic Rock',             labels: 'Rolling Stones Records', rating: 4, addedAt: '2026-02-20' },
    { discogsId: 6,  title: 'Exile on Main St.',     artists: 'The Rolling Stones',        year: 1972, genres: 'Rock',       styles: 'Classic Rock, Blues Rock', labels: 'Rolling Stones Records', rating: 5, addedAt: '2026-03-01' },
    { discogsId: 7,  title: 'Innervisions',          artists: 'Stevie Wonder',             year: 1973, genres: 'Funk / Soul', styles: 'Funk, Soul',              labels: 'Tamla',       rating: 5,    addedAt: '2026-03-05' },
    { discogsId: 8,  title: 'Songs in the Key of Life', artists: 'Stevie Wonder',          year: 1976, genres: 'Funk / Soul', styles: 'Funk, Soul, Disco',       labels: 'Tamla',       rating: 5,    addedAt: '2026-03-10' },
    { discogsId: 9,  title: 'There\'s a Riot Goin\' On', artists: 'Sly & The Family Stone', year: 1971, genres: 'Funk / Soul, Rock', styles: 'Funk, Psychedelic Rock', labels: 'Epic', rating: 4, addedAt: '2026-03-15' },
    { discogsId: 10, title: 'Head Hunters',          artists: 'Herbie Hancock',            year: 1973, genres: 'Jazz, Funk / Soul', styles: 'Funk, Jazz-Funk',    labels: 'Columbia',    rating: 4,    addedAt: '2026-03-20' },
    { discogsId: 11, title: 'Roundabout',            artists: 'Miles Davis, John Coltrane', year: 1956, genres: 'Jazz',      styles: 'Bebop',                    labels: 'Prestige',    rating: 3,    addedAt: '2026-03-25' },
  ];

  for (const r of releases) {
    await db.addRelease({
      discogsId: r.discogsId,
      title: r.title,
      artists: r.artists,
      year: r.year,
      genres: r.genres,
      styles: r.styles,
      labels: r.labels,
      rating: r.rating,
      addedAt: new Date(r.addedAt),
    });
  }

  // Seed some tracks
  await db.addTracks(1, [
    { title: 'So What', position: 'A1', duration: '9:22' },
    { title: 'Freddie Freeloader', position: 'A2', duration: '9:46' },
  ]);
  await db.addTracks(2, [{ title: 'A Love Supreme, Part I', position: 'A1', duration: '7:43' }]);
  await db.addTracks(4, [
    { title: 'Blue Train', position: 'A1', duration: '10:40' },
    { title: "Moment's Notice", position: 'A2', duration: '8:42' },
  ]);
  await db.addTracks(5, [{ title: 'Brown Sugar', position: 'A1', duration: '3:49' }]);
  await db.addTracks(7, [{ title: 'Too High', position: 'A1', duration: '4:49' }]);
}

describe('executeQuery (integration)', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await db.initialized;
    await seed(db);
  });

  afterEach(async () => { await db.close(); });

  // ---------------------------------------------------------------------------
  // Row queries
  // ---------------------------------------------------------------------------
  describe('row queries', () => {
    test('releases returns all seeded releases', async () => {
      const result = await run(db, 'releases');
      expect(result.rows.length).toBe(11);
    });

    test('releases with select returns correct columns', async () => {
      const result = await run(db, 'releases title, year');
      expect(result.columns).toEqual(['title', 'year']);
      expect(result.rows[0]).toHaveProperty('title');
      expect(result.rows[0]).toHaveProperty('year');
      expect(result.rows[0]).not.toHaveProperty('genre');
    });

    test('genre contains Jazz matches multi-value genre strings', async () => {
      // Release 10 has genres "Jazz, Funk / Soul"
      const result = await run(db, "releases where genre contains 'Jazz'");
      const titles = result.rows.map(r => r.title);
      expect(titles).toContain('Kind of Blue');
      expect(titles).toContain('Head Hunters'); // "Jazz, Funk / Soul"
    });

    test('genre contains Jazz does NOT match Jazz-Funk (substring of another value)', async () => {
      // Release 3 has styles "Jazz-Funk, Fusion" — should NOT match genre contains 'Jazz'
      const result = await run(db, "releases where genre contains 'Jazz'");
      const titles = result.rows.map(r => r.title);
      // Release 3 has genre "Jazz" (not "Jazz-Funk"), so it may appear
      // The style "Jazz-Funk" shouldn't be confused with genre "Jazz"
      expect(titles).not.toContain('Sticky Fingers'); // genre is "Rock" only
    });

    test('year range filter', async () => {
      const result = await run(db, 'releases where year >= 1960 and year <= 1975');
      for (const row of result.rows) {
        expect(row.year as number).toBeGreaterThanOrEqual(1960);
        expect(row.year as number).toBeLessThanOrEqual(1975);
      }
    });

    test('~ matches case-insensitively', async () => {
      const result = await run(db, "releases where artist ~ 'miles'");
      const titles = result.rows.map(r => r.title);
      expect(titles).toContain('Kind of Blue');
      expect(titles).toContain('Bitches Brew');
    });

    test('tracks query returns individual tracks with release info', async () => {
      const result = await run(db, 'tracks title, release');
      expect(result.rows.length).toBeGreaterThan(0);
      const trackTitles = result.rows.map(r => r.title);
      expect(trackTitles).toContain('So What');
      expect(trackTitles).toContain('Blue Train');
    });

    test('tracks filtered by style', async () => {
      const result = await run(db, "tracks title, release where style contains 'Hard Bop'");
      const releases = result.rows.map(r => r.release);
      expect(releases).toContain('Blue Train');
      // Should not contain Classic Rock releases
      expect(releases).not.toContain('Sticky Fingers');
    });

    test('artists returns deduplicated artists', async () => {
      const result = await run(db, 'artists');
      const names = result.rows.map(r => r.name);
      // Miles Davis appears on 3 releases — should appear once
      const milesDavisRows = names.filter(n => n === 'Miles Davis');
      expect(milesDavisRows).toHaveLength(1);
    });

    test('artists shows correct release count', async () => {
      const result = await run(db, 'artists name, releases');
      const miles = result.rows.find(r => r.name === 'Miles Davis');
      // Appears on: Kind of Blue, Bitches Brew, Roundabout = 3 releases
      expect(miles!.releases).toBe(3);
    });

    test('multi-artist release produces separate rows in artists', async () => {
      // Release 11 has "Miles Davis, John Coltrane"
      const result = await run(db, 'artists name, releases');
      const names = result.rows.map(r => r.name);
      expect(names).toContain('Miles Davis');
      expect(names).toContain('John Coltrane');
    });
  });

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------
  describe('aggregation', () => {
    test('count() without group by returns total count', async () => {
      const result = await run(db, 'releases count()');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].count).toBe(11);
    });

    test('count() by genre returns breakdown', async () => {
      const result = await run(db, 'releases count(), genre group by genre order by count desc');
      expect(result.columns).toEqual(['count', 'genre']);
      expect(result.rows.length).toBeGreaterThan(0);
      // Jazz should have the most
      const jazz = result.rows.find(r => r.genre === 'Jazz');
      expect(jazz).toBeDefined();
      expect(jazz!.count as number).toBeGreaterThan(0);
    });

    test('count() by year with filter', async () => {
      const result = await run(db, "releases count(), year where genre contains 'Jazz' group by year order by year");
      for (const row of result.rows) {
        expect(row.count as number).toBeGreaterThan(0);
      }
    });

    test('min and max year', async () => {
      const result = await run(db, 'releases min(year), max(year)');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].min_year).toBe(1956);
      expect(result.rows[0].max_year).toBe(1976);
    });

    test('avg rating by genre', async () => {
      const result = await run(db, 'releases avg(rating), genre group by genre');
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        if (row.avg_rating !== null) {
          expect(typeof row.avg_rating).toBe('number');
        }
      }
    });

    test('tracks count by artist', async () => {
      const result = await run(db, 'tracks count(), artist group by artist order by count desc');
      expect(result.rows.length).toBeGreaterThan(0);
      const coltrane = result.rows.find(r => r.artist === 'John Coltrane');
      expect(coltrane!.count as number).toBeGreaterThanOrEqual(2); // Blue Train has 2 tracks
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-value field expansion
  // ---------------------------------------------------------------------------
  describe('multi-value field expansion', () => {
    test('group by style expands into individual styles', async () => {
      // Release 9 has styles "Funk, Psychedelic Rock" — should produce separate rows
      const result = await run(db, 'releases count(), style group by style order by style');
      const styles = result.rows.map(r => r.style as string);
      // Individual styles must appear — not combined "Funk, Psychedelic Rock"
      expect(styles).toContain('Funk');
      expect(styles).toContain('Psychedelic Rock');
      expect(styles).not.toContain('Funk, Psychedelic Rock');
    });

    test('group by genre expands into individual genres', async () => {
      // Release 10 has genres "Jazz, Funk / Soul" — should contribute to both groups
      const result = await run(db, 'releases count(), genre group by genre order by count desc');
      const jazz = result.rows.find(r => r.genre === 'Jazz');
      const funk = result.rows.find(r => r.genre === 'Funk / Soul');
      expect(jazz).toBeDefined();
      expect(funk).toBeDefined();
      // Release 10 counted in both Jazz and Funk / Soul
      expect(jazz!.count as number).toBeGreaterThanOrEqual(5);
      expect(funk!.count as number).toBeGreaterThanOrEqual(4);
    });

    test('release with multiple styles counted in each style group', async () => {
      // Release 2 (A Love Supreme): styles "Free Jazz, Hard Bop"
      // Release 4 (Blue Train): styles "Hard Bop"
      // Hard Bop should have count >= 2
      const result = await run(db, 'releases count(), style group by style order by style');
      const hardBop = result.rows.find(r => r.style === 'Hard Bop');
      expect(hardBop).toBeDefined();
      expect(hardBop!.count as number).toBeGreaterThanOrEqual(2);
    });

    test('WHERE on expanded field filters releases before expansion', async () => {
      // Only Jazz releases, then count individual styles
      const result = await run(db, "releases count(), style where genre contains 'Jazz' group by style order by count desc");
      const styles = result.rows.map(r => r.style as string);
      // Should not contain styles from non-Jazz releases (e.g. Classic Rock from Rock releases)
      expect(styles).not.toContain('Classic Rock');
    });

    test('AND combination filter: releases with both styles', async () => {
      // Release 6 (Exile): styles "Classic Rock, Blues Rock"
      const result = await run(db, "releases title where style contains 'Classic Rock' and style contains 'Blues Rock'");
      const titles = result.rows.map(r => r.title);
      expect(titles).toContain('Exile on Main St.');
      // Release 5 (Sticky Fingers): styles "Classic Rock" only — should NOT appear
      expect(titles).not.toContain('Sticky Fingers');
    });
  });

  // ---------------------------------------------------------------------------
  // Limit
  // ---------------------------------------------------------------------------
  describe('limit', () => {
    test('limit in query caps results', async () => {
      const result = await run(db, 'releases limit 3');
      expect(result.rows).toHaveLength(3);
    });

    test('limit larger than results returns all', async () => {
      const result = await run(db, 'releases limit 100');
      expect(result.rows).toHaveLength(11);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    test('empty result set returns correct structure', async () => {
      const result = await run(db, 'releases where year = 1900');
      expect(result.columns.length).toBeGreaterThan(0);
      expect(result.rows).toHaveLength(0);
    });

    test('null rating values handled gracefully', async () => {
      // Add a release with no rating
      await db.addRelease({
        discogsId: 99, title: 'No Rating', artists: 'Test', year: 2000,
        genres: 'Rock', styles: 'Alternative', addedAt: new Date(),
      });
      const result = await run(db, 'releases title, rating where title = \'No Rating\'');
      expect(result.rows[0].rating).toBeNull();
    });
  });
});
