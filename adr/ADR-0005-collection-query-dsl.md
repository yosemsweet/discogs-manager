# ADR-0005: Collection Query DSL

**Status:** Accepted

## Context

Users wanted to run ad-hoc queries against their local collection beyond fixed CLI flags (genre, year, rating). The options were:

1. Expose raw SQLite (require users to know the schema)
2. Add more CLI flags to existing `collection list`
3. Implement a purpose-built query DSL

## Decision

Implement a lightweight SQL-ish DSL with a 5-stage pipeline:  
**parse → validate → build → execute → format**

The DSL covers three entities (`releases`, `tracks`, `artists`), filtering with `=`, `!=`, `>`, `<`, `>=`, `<=`, `~` (substring), and `contains` (whole-value in comma-separated fields), aggregation functions (`count`, `min`, `max`, `avg`, `sum`), GROUP BY, ORDER BY, and LIMIT.

All queries run locally against SQLite via `DatabaseManager.rawQuery()`. No API calls.

## Key design choices

### `contains` for multi-value fields
Discogs stores genres/styles/labels as comma-separated strings (e.g. `"Jazz, Funk / Soul"`). The `contains` operator expands to a 4-condition SQL OR that matches whole comma-separated values without false-positives on substrings:
```sql
(col = ? OR col LIKE ? OR col LIKE ? OR col LIKE ?)
-- 'Jazz', 'Jazz,%', '%, Jazz', '%, Jazz,%'
```

### Artists as a virtual entity via recursive CTE
The `releases.artists` column is comma-separated. Rather than requiring a normalized artists table, the `artists` entity is implemented as an on-the-fly recursive CTE that splits artists at query time. This keeps the schema simple at the cost of slightly heavier queries for the artists entity.

### `COALESCE(NULLIF(t.artists, ''), r.artists)` for track artists
`addTracks()` stores an empty string `''` (not NULL) when no per-track artist is specified. `COALESCE` alone wouldn't fall back to the release artist. Using `NULLIF` converts empty strings to NULL before the coalesce.

### `date(r.addedAt)` normalization
The `added` field applies `date()` in all SQL expressions so that GROUP BY groups by calendar day rather than full datetime values.

### Schema-driven validation
Entity/field definitions live in `src/services/query/schema.ts` as a declarative structure. Field type (`text`, `number`, `multi_text`, `date`) drives operator validation. This makes it easy to add new fields or entities without touching parser or builder logic.

### Parameterized queries only
All user-supplied values are passed as SQL parameters, never interpolated into the SQL string. This is enforced at the builder layer.

## Consequences

- Users can explore their collection with familiar SQL-like syntax without knowing the actual schema.
- The DSL is intentionally limited to read-only queries (no INSERT/UPDATE/DELETE).
- The `artists` entity is slightly approximate for `contains` filters (uses `LIKE '%value%'` against GROUP_CONCAT output rather than the 4-condition whole-value match).
- Adding new queryable fields requires updating only `schema.ts`.
