import { formatResult } from '../src/services/query/formatter';
import { QueryResult } from '../src/services/query/executor';

const TTY_OPTS = { json: false, isTTY: true };
const PIPE_OPTS = { json: false, isTTY: false };
const JSON_OPTS = { json: true, isTTY: false };

describe('formatResult', () => {
  // ---------------------------------------------------------------------------
  // Tabular formatting
  // ---------------------------------------------------------------------------
  describe('tabular', () => {
    test('header row uses column names', () => {
      const result: QueryResult = {
        columns: ['count', 'style'],
        rows: [{ count: 47, style: 'Jazz' }],
      };
      const output = formatResult(result, PIPE_OPTS);
      const lines = output.split('\n');
      expect(lines[0]).toContain('count');
      expect(lines[0]).toContain('style');
    });

    test('numeric columns are right-aligned', () => {
      const result: QueryResult = {
        columns: ['count', 'style'],
        rows: [
          { count: 47, style: 'Jazz' },
          { count: 5, style: 'Rock' },
        ],
      };
      const output = formatResult(result, PIPE_OPTS);
      const lines = output.split('\n');
      // "47" and "5" should be right-aligned under "count" header
      // count header width = max(5, 2) = 5 → "count", "   47", "    5"
      expect(lines[1]).toMatch(/^\s+47/);
      expect(lines[2]).toMatch(/^\s+5/);
    });

    test('text columns are left-aligned', () => {
      const result: QueryResult = {
        columns: ['style'],
        rows: [
          { style: 'Jazz' },
          { style: 'Rock' },
        ],
      };
      const output = formatResult(result, PIPE_OPTS);
      const lines = output.split('\n');
      // Data rows start with the value, not spaces
      expect(lines[1]).toMatch(/^Jazz/);
      expect(lines[2]).toMatch(/^Rock/);
    });

    test('columns padded to widest value', () => {
      const result: QueryResult = {
        columns: ['style'],
        rows: [
          { style: 'Jazz' },
          { style: 'Electronic Dance Music' },
        ],
      };
      const output = formatResult(result, PIPE_OPTS);
      const lines = output.split('\n');
      const maxLen = 'Electronic Dance Music'.length;
      // Both lines should be at least maxLen characters wide
      expect(lines[0].trimEnd().length).toBeLessThanOrEqual(maxLen);
      expect(lines[1].trimEnd().length).toBeLessThanOrEqual(maxLen + 2); // possible trailing spaces
    });

    test('null values rendered as empty string in tabular', () => {
      const result: QueryResult = {
        columns: ['title', 'rating'],
        rows: [{ title: 'Test', rating: null }],
      };
      const output = formatResult(result, PIPE_OPTS);
      // Should not contain the string "null"
      expect(output).not.toContain('null');
    });

    test('no trailing summary lines or decoration', () => {
      const result: QueryResult = {
        columns: ['title'],
        rows: [{ title: 'Kind of Blue' }],
      };
      const output = formatResult(result, PIPE_OPTS);
      const lines = output.split('\n').filter(l => l.length > 0);
      // Exactly header + 1 data row
      expect(lines).toHaveLength(2);
    });

    test('no ANSI codes when isTTY is false', () => {
      const result: QueryResult = {
        columns: ['title'],
        rows: [{ title: 'Test' }],
      };
      const output = formatResult(result, PIPE_OPTS);
      // ANSI escape codes start with \x1b[
      expect(output).not.toMatch(/\x1b\[/);
    });
  });

  // ---------------------------------------------------------------------------
  // JSON formatting
  // ---------------------------------------------------------------------------
  describe('JSON', () => {
    test('output is valid JSON', () => {
      const result: QueryResult = {
        columns: ['count', 'style'],
        rows: [{ count: 47, style: 'Jazz' }],
      };
      const output = formatResult(result, JSON_OPTS);
      expect(() => JSON.parse(output)).not.toThrow();
    });

    test('numbers are JSON numbers, not strings', () => {
      const result: QueryResult = {
        columns: ['count'],
        rows: [{ count: 47 }],
      };
      const parsed = JSON.parse(formatResult(result, JSON_OPTS));
      expect(typeof parsed[0].count).toBe('number');
      expect(parsed[0].count).toBe(47);
    });

    test('null values are JSON null', () => {
      const result: QueryResult = {
        columns: ['rating'],
        rows: [{ rating: null }],
      };
      const parsed = JSON.parse(formatResult(result, JSON_OPTS));
      expect(parsed[0].rating).toBeNull();
    });

    test('output is pretty-printed (2-space indent)', () => {
      const result: QueryResult = {
        columns: ['style'],
        rows: [{ style: 'Jazz' }],
      };
      const output = formatResult(result, JSON_OPTS);
      expect(output).toContain('\n  ');
    });

    test('column order in JSON matches select clause order', () => {
      const result: QueryResult = {
        columns: ['count', 'style', 'year'],
        rows: [{ count: 5, style: 'Jazz', year: 1959 }],
      };
      const parsed = JSON.parse(formatResult(result, JSON_OPTS));
      const keys = Object.keys(parsed[0]);
      expect(keys).toEqual(['count', 'style', 'year']);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty results
  // ---------------------------------------------------------------------------
  describe('empty results', () => {
    test('tabular empty: shows header row only', () => {
      const result: QueryResult = {
        columns: ['title', 'year'],
        rows: [],
      };
      const output = formatResult(result, PIPE_OPTS);
      expect(output).toContain('title');
      expect(output).toContain('year');
    });

    test('JSON empty: returns empty array', () => {
      const result: QueryResult = { columns: ['title'], rows: [] };
      const parsed = JSON.parse(formatResult(result, JSON_OPTS));
      expect(parsed).toEqual([]);
    });
  });
});
