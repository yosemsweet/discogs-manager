# Feature: `collection query` — Dynamic Collection Query System

## Motivation

The existing `collection stats` and `collection list` commands provide fixed views of the local Discogs collection. Users need richer, ad-hoc queries: breakdowns by style, year, date acquired; track-level listings filtered by artist or genre; artist summaries with release counts. Rather than adding a flag for each report, this feature introduces a single `collection query` command with a simplified SQL-ish DSL that supports filtering, projection, aggregation, and sorting — all operating locally against the SQLite database.

## Original examples this must support

* Show me a breakdown of releases by style
* Show me the breakdown of releases by year released
* Show me the breakdown of releases by date added to collection
* List all tracks for an artist by style or genre
* List all tracks by style
* List all artists I have releases for, including number of releases by style or genre

---

## Design

### CLI interface

```bash
collection query "<query string>" [--json] [--limit N]
```

- The query string is a single positional argument
- `--json` switches output from tabular text to a JSON array
- `--limit` on the CLI overrides any `limit` in the query string
- Tabular output suppresses color codes when stdout is not a TTY, so it pipes cleanly

### Domain model

Three queryable entities, each with a fixed set of fields. Users write these domain names, never raw SQLite column or table names.

| Entity | Fields | Notes |
|--------|--------|-------|
| `releases` | `title`, `artist`, `year`, `genre`, `style`, `label`, `rating`, `added` | Core entity; `genre`, `style`, `label` are comma-separated multi-value |
| `tracks` | `title`, `artist`, `position`, `duration`, `release`, `year`, `genre`, `style`, `label`, `added` | Implicit join to parent release for `year`, `genre`, `style`, `label`, `added` |
| `artists` | `name`, `releases`, `genres`, `styles` | Virtual entity: derived by splitting comma-separated `artists` on `releases` and aggregating |

### Grammar

```
<query>       ::= <entity> [<select>] [<where>] [<group_by>] [<order>] [<limit>]

<entity>      ::= "releases" | "tracks" | "artists"

<select>      ::= <select_item> ("," <select_item>)*
<select_item> ::= <field> | <agg_call>
<agg_call>    ::= <agg_func> "(" [<field>] ")"
<agg_func>    ::= "count" | "min" | "max" | "avg" | "sum"

<where>       ::= "where" <condition> ("and" <condition>)*
<condition>   ::= <field> <operator> <value>
<operator>    ::= "=" | "!=" | ">" | "<" | ">=" | "<=" | "~" | "contains"
<value>       ::= "'" <string> "'" | <number>

<group_by>    ::= "group by" <field> ("," <field>)*

<order>       ::= "order by" <order_item> ("," <order_item>)*
<order_item>  ::= (<field> | <agg_func>) ["asc" | "desc"]

<limit>       ::= "limit" <number>
```

**Operators:**
- `=`, `!=`, `>`, `<`, `>=`, `<=` — standard comparisons
- `~` — case-insensitive substring match (maps to `LIKE '%...%' COLLATE NOCASE`)
- `contains` — matches a value within a comma-separated field: `genre contains 'Jazz'` matches `"Jazz"`, `"Jazz, Funk"`, `"Bebop, Jazz"` but not `"Jazz-Funk"`

**Aggregation functions:**
- `count()` — count rows (no argument) or non-null values of a field
- `count(field)` — count non-null values
- `min(field)`, `max(field)` — minimum/maximum value
- `avg(field)`, `sum(field)` — numeric aggregation

**Rules:**
- If any `<select_item>` is an `<agg_call>`, a `group by` clause is required (unless the aggregation is over the entire result set, e.g., `releases count()`)
- Non-aggregated fields in `<select>` must appear in `group by`
- `order by` can reference aggregation functions (e.g., `order by count desc`) or grouped fields
- If `<select>` is omitted, all fields for the entity are returned (only valid without `group by`)

---

### Examples

#### Row queries (no aggregation)

```bash
# All releases, all columns
collection query "releases"

# Specific columns
collection query "releases title, artist, year"

# Filtering
collection query "releases where genre contains 'Jazz'"
collection query "releases where year >= 1960 and year <= 1969"
collection query "releases where added >= '2026-01-01'"
collection query "releases where style contains 'Hard Bop' order by year"
collection query "releases where artist ~ 'miles' order by added desc"

# Track-level
collection query "tracks where artist ~ 'Miles Davis'"
collection query "tracks title, artist, release where style contains 'Hard Bop'"
collection query "tracks where genre contains 'Jazz' and year < 1970 order by artist"

# Artist-level
collection query "artists"
collection query "artists where genres contains 'Jazz'"
collection query "artists name, releases where styles contains 'Hard Bop' order by releases desc"
```

#### Aggregation queries

```bash
# Breakdown of releases by style
collection query "releases count(), style group by style order by count desc"

# Releases by year
collection query "releases count(), year group by year order by year"

# Releases by date added (year)
collection query "releases count(), added group by added order by added"

# Jazz releases by style
collection query "releases count(), style where genre contains 'Jazz' group by style order by count desc"

# Tracks per artist (top 10)
collection query "tracks count(), artist group by artist order by count desc limit 10"

# Artists by number of releases (filtered)
collection query "artists name, releases where styles contains 'Hard Bop' order by releases desc"

# Year range of Jazz releases
collection query "releases min(year), max(year) where genre contains 'Jazz'"

# Average rating by genre
collection query "releases avg(rating), genre group by genre order by avg desc"

# Releases per label
collection query "releases count(), label group by label order by count desc limit 20"
```

#### Satisfying the original examples

| Original request | Query |
|-----------------|-------|
| Breakdown of releases by style | `"releases count(), style group by style order by count desc"` |
| Breakdown of releases by year released | `"releases count(), year group by year order by year"` |
| Breakdown of releases by date added | `"releases count(), added group by added order by added"` |
| All tracks for an artist by style | `"tracks title, style where artist ~ 'Miles Davis' order by style"` |
| All tracks by style | `"tracks title, artist, style order by style"` |
| All artists with release count by genre | `"artists name, releases, genres order by releases desc"` |

### Output formats

**Tabular (default):**
```
count  style
  47   Jazz
  23   Rock
  18   Electronic
  12   Hard Bop
   9   Soul
```

**JSON (`--json`):**
```json
[
  {"count": 47, "style": "Jazz"},
  {"count": 23, "style": "Rock"},
  {"count": 18, "style": "Electronic"},
  {"count": 12, "style": "Hard Bop"},
  {"count": 9, "style": "Soul"}
]
```

Tabular rules:
- Right-align numeric columns, left-align text columns
- No color codes when stdout is not a TTY
- No trailing summary lines or decoration — output is just the header row + data rows
- Header row uses the field name or aggregation function name as the column label

---

## System Architecture

### Module overview

```
src/commands/query.ts          CLI entry point (command layer)
src/services/query/
  ├── parser.ts                Tokenizer + recursive-descent parser
  ├── schema.ts                Entity/field definitions, domain-to-SQL mapping
  ├── builder.ts               AST → parameterized SQLite SQL
  ├── executor.ts              Execute SQL, return row objects
  └── formatter.ts             Rows → tabular text or JSON
```

### Module contracts

#### 1. Parser (`src/services/query/parser.ts`)

**Responsibility:** Tokenize a raw query string and parse it into a structured AST. Has no knowledge of the database, schema, or field validity — it only understands the grammar's syntax.

**Exports:**

```typescript
interface QueryAST {
  entity: string;                          // "releases", "tracks", "artists"
  select: SelectItem[];                    // empty = all fields
  where: Condition[];                      // empty = no filter
  groupBy: string[];                       // empty = no grouping
  orderBy: OrderItem[];                    // empty = no sorting
  limit: number | null;                    // null = no limit
}

interface SelectItem {
  type: 'field' | 'aggregation';
  field?: string;                          // field name, or undefined for count()
  aggregation?: 'count' | 'min' | 'max' | 'avg' | 'sum';
}

interface Condition {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | 'contains';
  value: string | number;
}

interface OrderItem {
  field?: string;                          // field name, or undefined if ordering by aggregation
  aggregation?: 'count' | 'min' | 'max' | 'avg' | 'sum';
  direction: 'asc' | 'desc';
}

class QueryParseError extends Error {
  position: number;                        // character offset where parsing failed
  expected: string;                        // human-readable description of what was expected
}

function parseQuery(input: string): QueryAST;
```

**Behavior:**
- Tokenizes the input string (handles quoted strings, keywords, operators, numbers)
- Builds the AST via recursive descent following the grammar
- Throws `QueryParseError` with position and expected-token info on invalid syntax
- Does NOT validate field names against any schema — `"releases foo, bar where baz = 1"` parses successfully

#### 2. Schema (`src/services/query/schema.ts`)

**Responsibility:** Define the domain model — which entities exist, which fields each entity has, each field's type, and how each field maps to a SQLite column expression. Validate a QueryAST against the schema.

**Exports:**

```typescript
type FieldType = 'text' | 'number' | 'date' | 'multi_text';

interface FieldDefinition {
  name: string;                            // domain name as written in queries
  type: FieldType;
  column: string;                          // SQLite column expression (e.g., "r.genres")
  description: string;                     // for --help / error messages
}

interface EntityDefinition {
  name: string;                            // "releases", "tracks", "artists"
  fromClause: string;                      // SQLite FROM + JOINs
  fields: FieldDefinition[];
  defaultSelect: string[];                 // fields returned when select is empty
  defaultOrderBy: OrderItem[];             // default sort when none specified
}

class SchemaValidationError extends Error {
  entity: string;
  field: string;
  reason: string;
}

function getEntityDefinition(name: string): EntityDefinition;
function validateAST(ast: QueryAST): void;
function getAvailableEntities(): string[];
function getFieldsForEntity(entity: string): FieldDefinition[];
```

**Behavior:**
- `validateAST` checks: entity exists, all referenced fields exist on that entity, aggregation/group-by consistency (non-aggregated select fields must be in group by), `contains` only used on `multi_text` fields, numeric operators not used on text fields
- Throws `SchemaValidationError` with specific details on what's wrong
- The schema is defined declaratively — adding a new field or entity means adding an entry, not changing logic

**Entity-to-SQL mappings:**

| Entity | `fromClause` |
|--------|-------------|
| `releases` | `releases r` |
| `tracks` | `tracks t JOIN releases r ON t.releaseId = r.discogsId` |
| `artists` | *(special handling — CTE or subquery that splits comma-separated artists)* |

**Field-to-column mappings (examples):**

| Entity.Field | Column | Type |
|-------------|--------|------|
| `releases.title` | `r.title` | `text` |
| `releases.artist` | `r.artists` | `text` |
| `releases.genre` | `r.genres` | `multi_text` |
| `releases.added` | `r.addedAt` | `date` |
| `tracks.title` | `t.title` | `text` |
| `tracks.release` | `r.title` | `text` |
| `tracks.year` | `r.year` | `number` |
| `artists.name` | derived | `text` |
| `artists.releases` | derived (count) | `number` |

#### 3. Query Builder (`src/services/query/builder.ts`)

**Responsibility:** Transform a validated QueryAST into a parameterized SQLite query string and parameter array. Consumes the schema to resolve domain fields to SQL expressions.

**Exports:**

```typescript
interface BuiltQuery {
  sql: string;
  params: (string | number)[];
}

function buildQuery(ast: QueryAST): BuiltQuery;
```

**Behavior:**
- Resolves entity to `FROM` clause, fields to column expressions via `schema.ts`
- Translates `contains` on `multi_text` fields to: `(column LIKE ? OR column LIKE ? OR column LIKE ? OR column = ?)` with params `['%,value', '%,value,%', 'value,%', 'value']` — matching the value as a whole item within the comma-separated list, not as a substring of another value
- Translates `~` to `column LIKE ? COLLATE NOCASE` with `%value%`
- Wraps aggregation functions: `count()` → `COUNT(*)`, `count(field)` → `COUNT(column)`, etc.
- Adds `GROUP BY` clause from `groupBy` fields
- Handles `order by count desc` by matching the aggregation function name back to its SELECT expression
- When the entity is `artists`, generates a CTE that splits the comma-separated `r.artists` column into individual artist rows, then aggregates
- Adds `date(column)` for `date` type fields in `GROUP BY` to normalize datetime values to dates
- All user-provided values are parameterized — never interpolated into SQL

#### 4. Executor (`src/services/query/executor.ts`)

**Responsibility:** Execute a built query against the SQLite database and return rows as plain objects.

**Exports:**

```typescript
interface QueryResult {
  columns: string[];                       // ordered column names (domain names, not SQL)
  rows: Record<string, string | number | null>[];
}

function executeQuery(db: DatabaseManager, built: BuiltQuery, ast: QueryAST): QueryResult;
```

**Behavior:**
- Calls `db.prepare(built.sql).all(...built.params)`
- Maps result column names back to domain field names using the AST's select list
- Applies CLI `--limit` override if present (truncates rows)
- Returns `QueryResult` with column ordering matching the select clause (or default order if no select)

#### 5. Formatter (`src/services/query/formatter.ts`)

**Responsibility:** Render a `QueryResult` into a string for output — either aligned tabular text or JSON.

**Exports:**

```typescript
interface FormatOptions {
  json: boolean;
  isTTY: boolean;                          // controls whether to apply color/alignment
}

function formatResult(result: QueryResult, options: FormatOptions): string;
```

**Behavior:**
- **Tabular mode** (`json: false`):
  - Prints a header row with column names
  - Right-aligns numeric columns, left-aligns text columns
  - Pads columns to the widest value in each column
  - No trailing newline after the last row, no summary line, no decoration
  - When `isTTY` is false: no ANSI codes, no color — plain text only
- **JSON mode** (`json: true`):
  - Outputs `JSON.stringify(rows, null, 2)` — a pretty-printed array of objects
  - Numbers are numbers, not strings; nulls are `null`

#### 6. Query Command (`src/commands/query.ts`)

**Responsibility:** CLI entry point. Wires the pipeline: parse → validate → build → execute → format → stdout.

**Exports:**

```typescript
function createQueryCommand(db: DatabaseManager): Command;
```

**Behavior:**
- Registers `collection query <query> [--json] [--limit N]` via Commander
- Calls `parseQuery(queryString)` — catches `QueryParseError`, prints user-friendly message with caret pointing at the error position
- Calls `validateAST(ast)` — catches `SchemaValidationError`, prints message with the valid alternatives (e.g., "Unknown field 'genr' on releases. Available fields: title, artist, year, genre, style, label, rating, added")
- Applies `--limit` override onto `ast.limit`
- Calls `buildQuery(ast)` → `executeQuery(db, built, ast)` → `formatResult(result, opts)`
- Writes formatted output to stdout
- Exit code 0 on success, 1 on query errors

### Data flow

```
User input: collection query "releases count(), style where genre contains 'Jazz' group by style order by count desc" --json

  ┌─────────────────────────────────────────────────────────────────────┐
  │ query.ts (command)                                                  │
  │   raw string + flags                                                │
  │     │                                                               │
  │     ▼                                                               │
  │ parser.ts ──── "releases count(), style where genre contains        │
  │                 'Jazz' group by style order by count desc"           │
  │     │                                                               │
  │     ▼  QueryAST                                                     │
  │ schema.ts ──── validates entity, fields, aggregation consistency    │
  │     │                                                               │
  │     ▼  validated QueryAST                                           │
  │ builder.ts ─── SELECT COUNT(*), r.genres FROM releases r            │
  │                 WHERE (r.genres LIKE ? OR ...) GROUP BY r.genres     │
  │                 ORDER BY COUNT(*) DESC                               │
  │     │          params: ['%,Jazz', '%,Jazz,%', 'Jazz,%', 'Jazz']     │
  │     ▼  BuiltQuery { sql, params }                                   │
  │ executor.ts ── db.prepare(sql).all(...params)                       │
  │     │                                                               │
  │     ▼  QueryResult { columns, rows }                                │
  │ formatter.ts ─ JSON array or tabular text                           │
  │     │                                                               │
  │     ▼                                                               │
  │   stdout                                                            │
  └─────────────────────────────────────────────────────────────────────┘
```

### Design decisions

**Why a pipeline of small modules instead of one monolith:**
Each module has a single concern and a testable contract. The parser can be tested without a database. The builder can be tested without executing SQL. The formatter can be tested without any query logic. This also means each module can evolve independently — e.g., adding a new entity only touches schema.ts.

**Why `artists` is a virtual entity:**
The `releases` table stores artists as a comma-separated string (e.g., `"Miles Davis, John Coltrane"`). There is no `artists` table. To query artists as a first-class entity, the builder generates a CTE that splits this column into individual rows. This is encapsulated in `schema.ts` and `builder.ts` — the parser and formatter don't know artists are special.

**Why `contains` instead of `=` for multi-value fields:**
Genre, style, and label are stored as comma-separated values. `genre = 'Jazz'` would require an exact full-string match, which almost never works. `contains` is a domain-aware operator that matches individual values within the list. The schema enforces that `contains` is only valid on `multi_text` fields.

**Why not expose raw SQL:**
Raw SQL against the database would be more flexible but introduces security risk (even locally), requires knowledge of table/column names, and provides no guardrails on valid queries. The DSL constrains the query space to safe, meaningful operations while still being dynamic.

---

## Success Criteria

### Row queries
- `collection query "releases"` outputs all releases as a formatted table with all default columns
- `collection query "releases title, artist, year"` outputs only those three columns
- `collection query "releases where genre contains 'Jazz'"` returns only releases where the `genres` field includes "Jazz" as a distinct value (matches `"Jazz"`, `"Jazz, Funk"`, but not `"Jazz-Funk"`)
- `collection query "releases where year >= 1960 and year <= 1969 order by year"` returns only 1960s releases, sorted
- `collection query "releases where artist ~ 'miles'"` matches case-insensitively
- `collection query "tracks where artist ~ 'Miles Davis'"` returns individual tracks with release metadata
- `collection query "tracks title, artist, release where style contains 'Hard Bop'"` returns three columns of tracks
- `collection query "artists"` returns all artists with release counts and genres
- `collection query "artists where styles contains 'Hard Bop' order by releases desc"` filters and sorts artists

### Aggregation queries
- `collection query "releases count(), style group by style order by count desc"` returns a two-column breakdown
- `collection query "releases count(), year group by year order by year"` returns year-by-year counts
- `collection query "releases count(), added group by added order by added"` groups by date acquired
- `collection query "releases count(), style where genre contains 'Jazz' group by style order by count desc"` filters first, then groups
- `collection query "tracks count(), artist group by artist order by count desc limit 10"` returns top 10 artists by track count
- `collection query "releases min(year), max(year) where genre contains 'Jazz'"` returns a single row with two values
- `collection query "releases avg(rating), genre group by genre order by avg desc"` returns average ratings

### Output formatting
- Default output is an aligned text table with a header row
- `--json` outputs a valid JSON array where numbers are numbers and nulls are null
- Tabular output contains no ANSI color codes when piped (stdout is not a TTY)
- Tabular output has no trailing summary or decoration lines

### Error handling
- An invalid query like `"releases where"` produces a parse error with position and expected token
- An unknown field like `"releases where genr contains 'Jazz'"` produces a validation error listing valid fields
- `contains` used on a non-multi-value field (e.g., `year contains '5'`) produces a validation error
- Aggregation without group by where group by is needed produces a clear error
- Non-aggregated select fields missing from group by produces a clear error

### Security
- All user-provided values in the query are bound as SQL parameters, never interpolated
- The query system cannot execute arbitrary SQL — only the grammar's operations are available

### Compatibility
- Existing `collection stats` and `collection list` commands are unchanged
- No database schema changes required — queries run against existing tables

---

## Test Plan

### Parser tests (`tests/query-parser.test.ts`)

**Entity parsing:**
- Parses bare entity: `"releases"` → `{ entity: "releases", select: [], where: [], groupBy: [], orderBy: [], limit: null }`
- Parses all three entities: `"releases"`, `"tracks"`, `"artists"`
- Rejects unknown entity: `"albums"` → `QueryParseError`

**Select parsing:**
- Parses single field: `"releases title"` → `select: [{ type: 'field', field: 'title' }]`
- Parses multiple fields: `"releases title, artist, year"` → three select items
- Parses aggregation without argument: `"releases count()"` → `select: [{ type: 'aggregation', aggregation: 'count' }]`
- Parses aggregation with argument: `"releases min(year)"` → `select: [{ type: 'aggregation', aggregation: 'min', field: 'year' }]`
- Parses mixed fields and aggregations: `"releases count(), style"` → two select items
- Parses all aggregation functions: `count`, `min`, `max`, `avg`, `sum`

**Where parsing:**
- Parses single condition with string value: `"releases where genre contains 'Jazz'"` → one condition
- Parses single condition with numeric value: `"releases where year >= 1960"` → one condition
- Parses multiple AND conditions: `"releases where year >= 1960 and year <= 1969"` → two conditions
- Parses all operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `~`, `contains`
- Handles single-quoted strings with spaces: `"releases where artist = 'Miles Davis'"` → value is `"Miles Davis"`
- Rejects unterminated string: `"releases where artist = 'Miles"` → `QueryParseError`

**Group by parsing:**
- Parses single group by: `"releases count() group by style"` → `groupBy: ['style']`
- Parses multiple group by fields: `"releases count() group by style, genre"` → two items

**Order by parsing:**
- Parses order by field ascending (default): `"releases order by year"` → `[{ field: 'year', direction: 'asc' }]`
- Parses order by field descending: `"releases order by year desc"` → `direction: 'desc'`
- Parses order by aggregation: `"releases count() group by style order by count desc"` → `[{ aggregation: 'count', direction: 'desc' }]`

**Limit parsing:**
- Parses limit: `"releases limit 10"` → `limit: 10`
- Rejects non-numeric limit: `"releases limit abc"` → `QueryParseError`

**Full query parsing:**
- Parses complete query with all clauses: `"releases count(), style where genre contains 'Jazz' group by style order by count desc limit 20"`
- Clause order is enforced: `"releases order by year where year > 1960"` → `QueryParseError`

**Error reporting:**
- `QueryParseError` includes character position of failure
- `QueryParseError` includes human-readable expected description

### Schema validation tests (`tests/query-schema.test.ts`)

**Entity validation:**
- Accepts valid entities: `releases`, `tracks`, `artists`
- Rejects unknown entity with helpful error

**Field validation:**
- Accepts valid fields for each entity
- Rejects unknown field with error listing available fields
- Accepts inherited fields on `tracks` (e.g., `year`, `genre`)

**Operator validation:**
- Rejects `contains` on non-multi-text field (e.g., `year contains '5'`)
- Allows `contains` on `genre`, `style`, `label`
- Allows `~` on text fields
- Allows comparison operators on numeric fields

**Aggregation validation:**
- Accepts aggregation with `group by` where non-aggregated fields are in group by
- Rejects aggregation select where a non-aggregated field is missing from group by
- Accepts aggregation without group by when the entire result is one row (e.g., `releases count()`)
- Rejects `avg`/`sum` on non-numeric fields

**Type checking:**
- Rejects numeric comparison on text field (e.g., `title > 5`)
- Allows numeric comparison on `year`, `rating`

### Query builder tests (`tests/query-builder.test.ts`)

**Basic SELECT generation:**
- `"releases"` → `SELECT r.title, r.artists, ... FROM releases r`
- `"releases title, year"` → `SELECT r.title, r.year FROM releases r`
- `"tracks title, release"` → `SELECT t.title, r.title FROM tracks t JOIN releases r ON t.releaseId = r.discogsId`

**WHERE generation:**
- `genre contains 'Jazz'` → parameterized `(r.genres LIKE ? OR r.genres LIKE ? OR r.genres LIKE ? OR r.genres = ?)` with params `['%,Jazz', '%,Jazz,%', 'Jazz,%', 'Jazz']`
- `artist ~ 'miles'` → `r.artists LIKE ? COLLATE NOCASE` with param `'%miles%'`
- `year >= 1960` → `r.year >= ?` with param `1960`
- Multiple conditions produce `AND`-joined clauses

**Aggregation generation:**
- `count()` → `COUNT(*)`
- `count(title)` → `COUNT(r.title)`
- `min(year)` → `MIN(r.year)`
- Group by generates `GROUP BY` clause with correct column expressions

**ORDER BY generation:**
- `order by year` → `ORDER BY r.year ASC`
- `order by count desc` → `ORDER BY COUNT(*) DESC`

**LIMIT generation:**
- `limit 10` → `LIMIT 10`

**Artists entity:**
- Generates CTE that splits comma-separated artist names into rows
- Aggregates release count, genres, styles per artist

**Parameter safety:**
- All string and numeric values appear in params array, never in the SQL string itself

### Executor tests (`tests/query-executor.test.ts`)

These are integration tests that run against a real in-memory SQLite database seeded with test data.

**Test data setup:**
- Seed 10+ releases spanning multiple genres, styles, years, artists, and labels
- Seed tracks for each release with varying artists and positions
- Include multi-artist releases (e.g., `"Miles Davis, John Coltrane"`)
- Include releases with overlapping multi-value fields (e.g., genres `"Jazz, Funk"`)

**Row query execution:**
- `"releases"` returns all seeded releases
- `"releases where genre contains 'Jazz'"` returns only Jazz releases (including those with `"Jazz, Funk"`)
- `"releases where genre contains 'Jazz'"` does NOT match a release with genre `"Jazz-Funk"` (substring check, not value-level match)
- `"tracks where artist ~ 'miles'"` returns matching tracks with inherited release fields
- `"artists"` returns deduplicated artist list with correct release counts

**Aggregation execution:**
- `"releases count(), genre group by genre order by count desc"` returns correct counts per genre
- `"releases count()"` with no group by returns a single row with total count
- `"releases min(year), max(year)"` returns correct min and max
- `"releases avg(rating), genre group by genre"` returns correct averages (handles null ratings)

**Limit execution:**
- `limit 3` in query returns exactly 3 rows when data has more
- CLI `--limit` override caps results

**Edge cases:**
- Empty result set returns `{ columns: [...], rows: [] }`
- Null values in optional fields (rating, condition) appear as `null` in results
- Multi-artist releases produce separate rows in `artists` entity queries

### Formatter tests (`tests/query-formatter.test.ts`)

**Tabular formatting:**
- Aligns columns to widest value
- Right-aligns numeric columns (count, year, rating)
- Left-aligns text columns (title, artist, genre)
- Header row uses domain field names
- No trailing newline after last row
- No ANSI codes when `isTTY: false`

**JSON formatting:**
- Output is valid JSON (parseable by `JSON.parse`)
- Numbers are JSON numbers, not strings
- Null values are JSON `null`
- Pretty-printed with 2-space indentation
- Column order in each object matches select clause order

**Empty result:**
- Tabular: only header row, no data rows
- JSON: empty array `[]`

### End-to-end tests (`tests/query-e2e.test.ts`)

Full pipeline tests (string in → formatted output) against a seeded database:

- Each of the six "original examples" queries produces the expected output
- `--json` flag produces parseable JSON
- Parse error on invalid query shows position and expected token
- Validation error on unknown field shows available fields
- No color codes in output (tests run with `isTTY: false`)

---

## Documentation updates required

- New `development-docs/systems/collection-query/documentation.md` describing the system, grammar reference, and examples
- Update `development-docs/systems/index.md` to add the collection query system
- ADR if any architectural decisions are made during implementation (e.g., parser strategy, artists CTE approach)
