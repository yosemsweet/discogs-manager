import { parseQuery } from '../src/services/query/parser';
import {
  validateAST,
  SchemaValidationError,
  getFieldsForEntity,
  getAvailableEntities,
} from '../src/services/query/schema';

function validate(query: string) {
  return validateAST(parseQuery(query));
}

describe('validateAST', () => {
  // ---------------------------------------------------------------------------
  // Entity validation
  // ---------------------------------------------------------------------------
  describe('entity', () => {
    test('accepts releases', () => expect(() => validate('releases')).not.toThrow());
    test('accepts tracks', () => expect(() => validate('tracks')).not.toThrow());
    test('accepts artists', () => expect(() => validate('artists')).not.toThrow());

    test('rejects unknown entity', () => {
      const ast = parseQuery('albums');
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('error message lists available entities', () => {
      const ast = parseQuery('albums');
      let err: SchemaValidationError | undefined;
      try { validateAST(ast); } catch (e) { err = e as SchemaValidationError; }
      expect(err!.message).toMatch(/releases/);
      expect(err!.message).toMatch(/tracks/);
      expect(err!.message).toMatch(/artists/);
    });
  });

  // ---------------------------------------------------------------------------
  // Field validation
  // ---------------------------------------------------------------------------
  describe('fields', () => {
    test('accepts valid releases fields', () => {
      expect(() => validate('releases title, artist, year, genre, style, label, rating, added')).not.toThrow();
    });

    test('accepts valid tracks fields', () => {
      expect(() => validate('tracks title, artist, release, year, genre, style')).not.toThrow();
    });

    test('accepts inherited tracks fields (year, genre from release)', () => {
      expect(() => validate('tracks year, genre, style, label, added')).not.toThrow();
    });

    test('accepts valid artists fields', () => {
      expect(() => validate('artists name, releases, genres, styles')).not.toThrow();
    });

    test('rejects unknown field with helpful message', () => {
      const ast = parseQuery('releases genr');
      let err: SchemaValidationError | undefined;
      try { validateAST(ast); } catch (e) { err = e as SchemaValidationError; }
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect(err!.message).toMatch(/genr/);
      expect(err!.message).toMatch(/genre/); // suggests correct field
    });

    test('rejects unknown where field', () => {
      const ast = parseQuery("releases where genr = 'Jazz'");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('rejects unknown group by field', () => {
      const ast = parseQuery("releases count() group by genr");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('rejects unknown order by field', () => {
      const ast = parseQuery("releases order by genr");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Operator validation
  // ---------------------------------------------------------------------------
  describe('operators', () => {
    test('allows contains on genre (multi_text)', () => {
      expect(() => validate("releases where genre contains 'Jazz'")).not.toThrow();
    });

    test('allows contains on style', () => {
      expect(() => validate("releases where style contains 'Hard Bop'")).not.toThrow();
    });

    test('allows contains on label', () => {
      expect(() => validate("releases where label contains 'Blue Note'")).not.toThrow();
    });

    test('allows contains on artists.genres', () => {
      expect(() => validate("artists where genres contains 'Jazz'")).not.toThrow();
    });

    test('rejects contains on year (number)', () => {
      const ast = parseQuery("releases where year contains '5'");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('rejects contains on title (text)', () => {
      const ast = parseQuery("releases where title contains 'Kind'");
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('allows ~ (substring) on text fields', () => {
      expect(() => validate("releases where artist ~ 'miles'")).not.toThrow();
    });

    test('allows numeric comparison on year', () => {
      expect(() => validate('releases where year > 1960')).not.toThrow();
    });

    test('allows numeric comparison on rating', () => {
      expect(() => validate('releases where rating >= 4')).not.toThrow();
    });

    test('rejects numeric comparison on text field', () => {
      const ast = parseQuery('releases where title > 5');
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Aggregation validation
  // ---------------------------------------------------------------------------
  describe('aggregation', () => {
    test('accepts count() with group by', () => {
      expect(() => validate('releases count(), style group by style')).not.toThrow();
    });

    test('accepts count() without group by (whole-result aggregation)', () => {
      expect(() => validate('releases count()')).not.toThrow();
    });

    test('rejects non-aggregated select field missing from group by', () => {
      const ast = parseQuery('releases count(), style group by genre');
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('error mentions the offending field', () => {
      const ast = parseQuery('releases count(), style group by genre');
      let err: SchemaValidationError | undefined;
      try { validateAST(ast); } catch (e) { err = e as SchemaValidationError; }
      expect(err!.message).toMatch(/style/);
    });

    test('rejects avg on non-numeric field', () => {
      const ast = parseQuery('releases avg(title) group by genre');
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('rejects sum on non-numeric field', () => {
      const ast = parseQuery('releases sum(artist) group by genre');
      expect(() => validateAST(ast)).toThrow(SchemaValidationError);
    });

    test('accepts avg on numeric field', () => {
      expect(() => validate('releases avg(rating) group by genre')).not.toThrow();
    });

    test('accepts min and max on any field type', () => {
      expect(() => validate('releases min(year), max(year)')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Schema helpers
  // ---------------------------------------------------------------------------
  describe('helpers', () => {
    test('getAvailableEntities returns all three', () => {
      expect(getAvailableEntities()).toEqual(expect.arrayContaining(['releases', 'tracks', 'artists']));
    });

    test('getFieldsForEntity returns fields for releases', () => {
      const fields = getFieldsForEntity('releases');
      const names = fields.map(f => f.name);
      expect(names).toContain('title');
      expect(names).toContain('year');
      expect(names).toContain('genre');
    });

    test('getFieldsForEntity throws for unknown entity', () => {
      expect(() => getFieldsForEntity('albums')).toThrow(SchemaValidationError);
    });
  });
});
