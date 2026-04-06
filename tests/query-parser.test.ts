import { parseQuery, QueryParseError, QueryAST } from '../src/services/query/parser';

describe('parseQuery', () => {
  // ---------------------------------------------------------------------------
  // Entity
  // ---------------------------------------------------------------------------
  describe('entity', () => {
    test('parses bare entity', () => {
      const ast = parseQuery('releases');
      expect(ast.entity).toBe('releases');
      expect(ast.select).toEqual([]);
      expect(ast.where).toEqual([]);
      expect(ast.groupBy).toEqual([]);
      expect(ast.orderBy).toEqual([]);
      expect(ast.limit).toBeNull();
    });

    test('parses all three entities', () => {
      expect(parseQuery('releases').entity).toBe('releases');
      expect(parseQuery('tracks').entity).toBe('tracks');
      expect(parseQuery('artists').entity).toBe('artists');
    });

    test('lowercases entity name', () => {
      expect(parseQuery('Releases').entity).toBe('releases');
    });
  });

  // ---------------------------------------------------------------------------
  // Select
  // ---------------------------------------------------------------------------
  describe('select', () => {
    test('parses single field', () => {
      const ast = parseQuery('releases title');
      expect(ast.select).toEqual([{ type: 'field', field: 'title' }]);
    });

    test('parses multiple fields', () => {
      const ast = parseQuery('releases title, artist, year');
      expect(ast.select).toHaveLength(3);
      expect(ast.select[0]).toEqual({ type: 'field', field: 'title' });
      expect(ast.select[1]).toEqual({ type: 'field', field: 'artist' });
      expect(ast.select[2]).toEqual({ type: 'field', field: 'year' });
    });

    test('parses count() with no argument', () => {
      const ast = parseQuery('releases count()');
      expect(ast.select).toEqual([{ type: 'aggregation', aggregation: 'count', field: undefined }]);
    });

    test('parses aggregation with argument', () => {
      const ast = parseQuery('releases min(year)');
      expect(ast.select).toEqual([{ type: 'aggregation', aggregation: 'min', field: 'year' }]);
    });

    test('parses all aggregation functions', () => {
      for (const fn of ['count', 'min', 'max', 'avg', 'sum']) {
        const ast = parseQuery(`releases ${fn}(year)`);
        expect(ast.select[0].type).toBe('aggregation');
        expect(ast.select[0].aggregation).toBe(fn);
      }
    });

    test('parses mixed fields and aggregations', () => {
      const ast = parseQuery('releases count(), style');
      expect(ast.select).toHaveLength(2);
      expect(ast.select[0]).toEqual({ type: 'aggregation', aggregation: 'count', field: undefined });
      expect(ast.select[1]).toEqual({ type: 'field', field: 'style' });
    });

    test('select stops at where keyword', () => {
      const ast = parseQuery('releases title where year = 1960');
      expect(ast.select).toEqual([{ type: 'field', field: 'title' }]);
      expect(ast.where).toHaveLength(1);
    });

    test('select stops at group keyword', () => {
      const ast = parseQuery('releases count() group by style');
      expect(ast.select).toHaveLength(1);
      expect(ast.groupBy).toEqual(['style']);
    });
  });

  // ---------------------------------------------------------------------------
  // Where
  // ---------------------------------------------------------------------------
  describe('where', () => {
    test('parses string condition', () => {
      const ast = parseQuery("releases where genre contains 'Jazz'");
      expect(ast.where).toHaveLength(1);
      expect(ast.where[0]).toEqual({ field: 'genre', operator: 'contains', value: 'Jazz' });
    });

    test('parses numeric condition', () => {
      const ast = parseQuery('releases where year >= 1960');
      expect(ast.where[0]).toEqual({ field: 'year', operator: '>=', value: 1960 });
    });

    test('parses multiple AND conditions', () => {
      const ast = parseQuery('releases where year >= 1960 and year <= 1969');
      expect(ast.where).toHaveLength(2);
      expect(ast.where[0]).toEqual({ field: 'year', operator: '>=', value: 1960 });
      expect(ast.where[1]).toEqual({ field: 'year', operator: '<=', value: 1969 });
    });

    test.each([
      ['=', '='],
      ['!=', '!='],
      ['>', '>'],
      ['<', '<'],
      ['>=', '>='],
      ['<=', '<='],
      ['~', '~'],
    ])('parses operator %s', (op, expected) => {
      const ast = parseQuery(`releases where year ${op} 1960`);
      expect(ast.where[0].operator).toBe(expected);
    });

    test('parses contains operator', () => {
      const ast = parseQuery("releases where genre contains 'Jazz'");
      expect(ast.where[0].operator).toBe('contains');
    });

    test('handles string with spaces', () => {
      const ast = parseQuery("releases where artist = 'Miles Davis'");
      expect(ast.where[0].value).toBe('Miles Davis');
    });

    test('throws on unterminated string', () => {
      expect(() => parseQuery("releases where artist = 'Miles")).toThrow(QueryParseError);
    });

    test('throws on missing value', () => {
      expect(() => parseQuery('releases where year >')).toThrow(QueryParseError);
    });

    test('throws on missing operator', () => {
      expect(() => parseQuery('releases where year')).toThrow(QueryParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Group by
  // ---------------------------------------------------------------------------
  describe('group by', () => {
    test('parses single field', () => {
      const ast = parseQuery('releases count() group by style');
      expect(ast.groupBy).toEqual(['style']);
    });

    test('parses multiple fields', () => {
      const ast = parseQuery('releases count() group by style, genre');
      expect(ast.groupBy).toEqual(['style', 'genre']);
    });

    test('throws on missing field after group by', () => {
      expect(() => parseQuery('releases count() group by')).toThrow(QueryParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Order by
  // ---------------------------------------------------------------------------
  describe('order by', () => {
    test('parses field with default asc direction', () => {
      const ast = parseQuery('releases order by year');
      expect(ast.orderBy).toEqual([{ field: 'year', direction: 'asc' }]);
    });

    test('parses field with explicit desc', () => {
      const ast = parseQuery('releases order by year desc');
      expect(ast.orderBy[0].direction).toBe('desc');
    });

    test('parses field with explicit asc', () => {
      const ast = parseQuery('releases order by year asc');
      expect(ast.orderBy[0].direction).toBe('asc');
    });

    test('parses aggregation function in order by', () => {
      const ast = parseQuery('releases count() group by style order by count desc');
      expect(ast.orderBy[0]).toEqual({ aggregation: 'count', direction: 'desc' });
    });

    test('parses multiple order by items', () => {
      const ast = parseQuery('releases order by year desc, title asc');
      expect(ast.orderBy).toHaveLength(2);
      expect(ast.orderBy[0]).toEqual({ field: 'year', direction: 'desc' });
      expect(ast.orderBy[1]).toEqual({ field: 'title', direction: 'asc' });
    });

    test('throws on missing field after order by', () => {
      expect(() => parseQuery('releases order by')).toThrow(QueryParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Limit
  // ---------------------------------------------------------------------------
  describe('limit', () => {
    test('parses numeric limit', () => {
      const ast = parseQuery('releases limit 10');
      expect(ast.limit).toBe(10);
    });

    test('throws on non-numeric limit', () => {
      expect(() => parseQuery('releases limit abc')).toThrow(QueryParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Full query
  // ---------------------------------------------------------------------------
  describe('full query', () => {
    test('parses all clauses together', () => {
      const ast = parseQuery(
        "releases count(), style where genre contains 'Jazz' group by style order by count desc limit 20"
      );
      expect(ast.entity).toBe('releases');
      expect(ast.select).toHaveLength(2);
      expect(ast.where).toHaveLength(1);
      expect(ast.groupBy).toEqual(['style']);
      expect(ast.orderBy).toHaveLength(1);
      expect(ast.limit).toBe(20);
    });

    test('rejects wrong clause order (order before where)', () => {
      expect(() => parseQuery('releases order by year where year > 1960')).toThrow(QueryParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Error reporting
  // ---------------------------------------------------------------------------
  describe('error reporting', () => {
    test('QueryParseError has position', () => {
      let err: QueryParseError | undefined;
      try { parseQuery('releases where'); } catch (e) { err = e as QueryParseError; }
      expect(err).toBeInstanceOf(QueryParseError);
      expect(typeof err!.position).toBe('number');
    });

    test('QueryParseError has expected description', () => {
      let err: QueryParseError | undefined;
      try { parseQuery('releases where'); } catch (e) { err = e as QueryParseError; }
      expect(err!.expected).toBeTruthy();
    });

    test('position points to the problematic token', () => {
      let err: QueryParseError | undefined;
      try { parseQuery("releases where artist = 'unclosed"); } catch (e) { err = e as QueryParseError; }
      expect(err).toBeInstanceOf(QueryParseError);
      expect(err!.position).toBeGreaterThanOrEqual(0);
    });
  });
});
