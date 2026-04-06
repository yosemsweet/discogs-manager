import { parseQuery } from '../src/services/query/parser';
import { validateAST } from '../src/services/query/schema';
import { buildQuery } from '../src/services/query/builder';

function build(query: string) {
  const ast = parseQuery(query);
  validateAST(ast);
  return buildQuery(ast);
}

describe('buildQuery', () => {
  // ---------------------------------------------------------------------------
  // Basic SELECT generation
  // ---------------------------------------------------------------------------
  describe('SELECT', () => {
    test('default select for releases includes expected columns', () => {
      const { sql, columns } = build('releases');
      expect(columns).toContain('title');
      expect(columns).toContain('artist');
      expect(columns).toContain('year');
      expect(sql).toContain('r.title AS title');
      expect(sql).toContain('FROM releases r');
    });

    test('explicit field selection', () => {
      const { sql, columns } = build('releases title, year');
      expect(columns).toEqual(['title', 'year']);
      expect(sql).toContain('r.title AS title');
      expect(sql).toContain('r.year AS year');
    });

    test('tracks join with releases', () => {
      const { sql } = build('tracks title, release');
      expect(sql).toContain('tracks t JOIN releases r ON t.releaseId = r.discogsId');
      expect(sql).toContain('t.title AS title');
      expect(sql).toContain('r.title AS release');
    });

    test('tracks artist uses COALESCE with NULLIF for empty string', () => {
      const { sql } = build('tracks artist');
      expect(sql).toContain('COALESCE(NULLIF(t.artists, \'\'), r.artists) AS artist');
    });

    test('date field uses date() function', () => {
      const { sql } = build('releases added');
      expect(sql).toContain('date(r.addedAt) AS added');
    });
  });

  // ---------------------------------------------------------------------------
  // WHERE generation
  // ---------------------------------------------------------------------------
  describe('WHERE', () => {
    test('contains on genre produces 4-condition match', () => {
      const { sql, params } = build("releases where genre contains 'Jazz'");
      expect(sql).toContain('WHERE');
      expect(sql).toContain('r.genres = ?');
      expect(sql).toContain('r.genres LIKE ?');
      expect(params).toContain('Jazz');
      expect(params).toContain('Jazz,%');
      expect(params).toContain('%, Jazz');
      expect(params).toContain('%, Jazz,%');
    });

    test('~ produces case-insensitive LIKE', () => {
      const { sql, params } = build("releases where artist ~ 'miles'");
      expect(sql).toContain('LIKE ? COLLATE NOCASE');
      expect(params).toContain('%miles%');
    });

    test('numeric comparison', () => {
      const { sql, params } = build('releases where year >= 1960');
      expect(sql).toContain('r.year >= ?');
      expect(params).toContain(1960);
    });

    test('multiple conditions joined with AND', () => {
      const { sql } = build('releases where year >= 1960 and year <= 1969');
      expect(sql).toContain('AND');
    });

    test('= comparison', () => {
      const { sql, params } = build('releases where rating = 5');
      expect(sql).toContain('r.rating = ?');
      expect(params).toContain(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------
  describe('aggregation', () => {
    test('count() produces COUNT(*)', () => {
      const { sql, columns } = build('releases count() group by style');
      expect(sql).toContain('COUNT(*) AS count');
      expect(columns).toContain('count');
    });

    test('min(year) produces MIN', () => {
      const { sql, columns } = build('releases min(year), max(year)');
      expect(sql).toContain('MIN(r.year) AS min_year');
      expect(sql).toContain('MAX(r.year) AS max_year');
      expect(columns).toEqual(['min_year', 'max_year']);
    });

    test('avg(rating) produces AVG', () => {
      const { sql } = build('releases avg(rating), genre group by genre');
      expect(sql).toContain('AVG(r.rating) AS avg_rating');
    });

    test('group by generates GROUP BY clause', () => {
      const { sql } = build('releases count(), style group by style');
      expect(sql).toContain('GROUP BY r.styles');
    });

    test('group by date field uses date() expression', () => {
      const { sql } = build('releases count(), added group by added');
      expect(sql).toContain('GROUP BY date(r.addedAt)');
    });
  });

  // ---------------------------------------------------------------------------
  // ORDER BY
  // ---------------------------------------------------------------------------
  describe('ORDER BY', () => {
    test('order by field ascending', () => {
      const { sql } = build('releases order by year asc');
      expect(sql).toContain('ORDER BY r.year ASC');
    });

    test('order by field descending', () => {
      const { sql } = build('releases order by year desc');
      expect(sql).toContain('ORDER BY r.year DESC');
    });

    test('order by aggregation alias', () => {
      const { sql } = build('releases count(), style group by style order by count desc');
      expect(sql).toContain('ORDER BY count DESC');
    });

    test('default order by applied when none specified', () => {
      const { sql } = build('releases');
      expect(sql).toContain('ORDER BY');
    });
  });

  // ---------------------------------------------------------------------------
  // LIMIT
  // ---------------------------------------------------------------------------
  describe('LIMIT', () => {
    test('generates LIMIT clause', () => {
      const { sql } = build('releases limit 10');
      expect(sql).toContain('LIMIT 10');
    });

    test('no LIMIT clause when not specified', () => {
      const { sql } = build('releases title');
      expect(sql).not.toContain('LIMIT');
    });
  });

  // ---------------------------------------------------------------------------
  // Artists CTE
  // ---------------------------------------------------------------------------
  describe('artists entity', () => {
    test('generates recursive CTE', () => {
      const { sql } = build('artists');
      expect(sql).toContain('WITH RECURSIVE artist_split');
      expect(sql).toContain('artist_data');
      expect(sql).toContain('COUNT(DISTINCT release_id) AS releases');
    });

    test('selects from artist_data', () => {
      const { sql } = build('artists');
      expect(sql).toContain('FROM artist_data');
    });

    test('artists contains on genres uses LIKE', () => {
      const { sql, params } = build("artists where genres contains 'Jazz'");
      expect(sql).toContain('LIKE ?');
      expect(params).toContain('%Jazz%');
    });

    test('artists name filter', () => {
      const { sql, params } = build("artists where name ~ 'miles'");
      expect(sql).toContain('name LIKE ? COLLATE NOCASE');
      expect(params).toContain('%miles%');
    });
  });

  // ---------------------------------------------------------------------------
  // Parameter safety
  // ---------------------------------------------------------------------------
  describe('parameter safety', () => {
    test('user string values are in params, not SQL string', () => {
      const { sql, params } = build("releases where artist = 'Miles Davis'");
      expect(sql).not.toContain('Miles Davis');
      expect(params).toContain('Miles Davis');
    });

    test('numeric values are in params', () => {
      const { sql, params } = build('releases where year = 1959');
      expect(sql).not.toContain('1959');
      expect(params).toContain(1959);
    });

    test('contains values are in params', () => {
      const { sql, params } = build("releases where genre contains 'Jazz'");
      expect(sql).not.toContain("'Jazz'");
      expect(params.every(p => typeof p === 'string' || typeof p === 'number')).toBe(true);
    });
  });
});
