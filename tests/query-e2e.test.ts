import { DatabaseManager } from '../src/services/database';
import { parseQuery, QueryParseError } from '../src/services/query/parser';
import { validateAST, SchemaValidationError } from '../src/services/query/schema';
import { buildQuery } from '../src/services/query/builder';
import { executeQuery } from '../src/services/query/executor';
import { formatResult } from '../src/services/query/formatter';

const PIPE_OPTS = { json: false, isTTY: false };
const JSON_OPTS = { json: true, isTTY: false };

async function query(db: DatabaseManager, q: string, opts = PIPE_OPTS): Promise<string> {
  const ast = parseQuery(q);
  validateAST(ast);
  const built = buildQuery(ast);
  const result = await executeQuery(db, built);
  return formatResult(result, opts);
}

async function seed(db: DatabaseManager) {
  const releases = [
    { discogsId: 1, title: 'Kind of Blue',     artists: 'Miles Davis',          year: 1959, genres: 'Jazz',          styles: 'Modal Jazz, Cool Jazz', labels: 'Columbia', rating: 5, addedAt: '2026-01-10' },
    { discogsId: 2, title: 'A Love Supreme',   artists: 'John Coltrane',        year: 1965, genres: 'Jazz',          styles: 'Free Jazz, Hard Bop',   labels: 'Impulse!', rating: 5, addedAt: '2026-01-20' },
    { discogsId: 3, title: 'Blue Train',       artists: 'John Coltrane',        year: 1957, genres: 'Jazz',          styles: 'Hard Bop',              labels: 'Blue Note',rating: 5, addedAt: '2026-02-01' },
    { discogsId: 4, title: 'Head Hunters',     artists: 'Herbie Hancock',       year: 1973, genres: 'Jazz, Funk / Soul', styles: 'Jazz-Funk, Funk',   labels: 'Columbia', rating: 4, addedAt: '2026-02-15' },
    { discogsId: 5, title: 'Sticky Fingers',   artists: 'The Rolling Stones',   year: 1971, genres: 'Rock',          styles: 'Classic Rock',          labels: 'RS Records',rating: 4, addedAt: '2026-03-01' },
    { discogsId: 6, title: 'Innervisions',     artists: 'Stevie Wonder',        year: 1973, genres: 'Funk / Soul',   styles: 'Funk, Soul',            labels: 'Tamla',    rating: 5, addedAt: '2026-03-10' },
  ];
  for (const r of releases) {
    await db.addRelease({ ...r, addedAt: new Date(r.addedAt) });
  }
  await db.addTracks(1, [
    { title: 'So What',            position: 'A1', duration: '9:22' },
    { title: 'Freddie Freeloader', position: 'A2', duration: '9:46' },
  ]);
  await db.addTracks(2, [{ title: 'A Love Supreme', position: 'A1', duration: '7:43' }]);
  await db.addTracks(3, [
    { title: 'Blue Train',       position: 'A1', duration: '10:40' },
    { title: "Moment's Notice",  position: 'A2', duration: '8:42' },
  ]);
  await db.addTracks(6, [{ title: 'Too High', position: 'A1', duration: '4:49' }]);
}

describe('collection query end-to-end', () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    db = new DatabaseManager(':memory:');
    await db.initialized;
    await seed(db);
  });

  afterEach(async () => { await db.close(); });

  // ---------------------------------------------------------------------------
  // Original feature request examples
  // ---------------------------------------------------------------------------
  describe('original examples', () => {
    test('breakdown of releases by style', async () => {
      const output = await query(db, 'releases count(), style group by style order by count desc');
      expect(output).toContain('count');
      expect(output).toContain('style');
      expect(output).toContain('Hard Bop');
    });

    test('breakdown of releases by year', async () => {
      const output = await query(db, 'releases count(), year group by year order by year');
      expect(output).toContain('count');
      expect(output).toContain('year');
      expect(output).toContain('1959');
    });

    test('breakdown of releases by date added', async () => {
      const output = await query(db, 'releases count(), added group by added order by added');
      expect(output).toContain('count');
      expect(output).toContain('added');
      expect(output).toContain('2026');
    });

    test('all tracks for an artist by style', async () => {
      const output = await query(db, "tracks title, style where artist ~ 'Miles Davis' order by style");
      expect(output).toContain('So What');
      expect(output).toContain('title');
    });

    test('all tracks by style', async () => {
      const output = await query(db, 'tracks title, artist, style order by style');
      expect(output).toContain('title');
      expect(output).toContain('artist');
      expect(output).toContain('style');
      expect(output).toContain('So What');
      expect(output).toContain('Blue Train');
    });

    test('all artists with release count by genre', async () => {
      const output = await query(db, 'artists name, releases, genres order by releases desc');
      expect(output).toContain('name');
      expect(output).toContain('releases');
      expect(output).toContain('genres');
      expect(output).toContain('John Coltrane');
    });
  });

  // ---------------------------------------------------------------------------
  // JSON output
  // ---------------------------------------------------------------------------
  describe('JSON output', () => {
    test('produces parseable JSON array', async () => {
      const output = await query(db, 'releases title, year', JSON_OPTS);
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('title');
      expect(parsed[0]).toHaveProperty('year');
    });

    test('JSON numbers are actual numbers', async () => {
      const output = await query(db, 'releases count(), year group by year order by year', JSON_OPTS);
      const parsed = JSON.parse(output);
      expect(typeof parsed[0].year).toBe('number');
      expect(typeof parsed[0].count).toBe('number');
    });

    test('JSON aggregation result', async () => {
      const output = await query(db, "releases count(), style where genre contains 'Jazz' group by style order by count desc", JSON_OPTS);
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      const hardBop = parsed.find((r: any) => r.style === 'Hard Bop');
      expect(hardBop).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    test('parse error on incomplete where clause', () => {
      expect(() => parseQuery('releases where')).toThrow(QueryParseError);
    });

    test('parse error includes position', () => {
      let err: QueryParseError | undefined;
      try { parseQuery('releases where'); } catch (e) { err = e as QueryParseError; }
      expect(typeof err!.position).toBe('number');
    });

    test('parse error includes expected description', () => {
      let err: QueryParseError | undefined;
      try { parseQuery('releases where'); } catch (e) { err = e as QueryParseError; }
      expect(err!.expected).toBeTruthy();
    });

    test('validation error on unknown field lists available fields', () => {
      const ast = parseQuery('releases where genr contains \'Jazz\'');
      let err: SchemaValidationError | undefined;
      try { validateAST(ast); } catch (e) { err = e as SchemaValidationError; }
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect(err!.message).toMatch(/genre/); // suggests correct field
    });

    test('validation error on contains with non-multi_text field', () => {
      const ast = parseQuery("releases where year contains '5'");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Output is pipe-clean (no ANSI codes)
  // ---------------------------------------------------------------------------
  test('tabular output has no ANSI escape codes', async () => {
    const output = await query(db, 'releases title, year', PIPE_OPTS);
    expect(output).not.toMatch(/\x1b\[/);
  });
});
