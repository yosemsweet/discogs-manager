# Collection Query System

## Overview

The collection query system provides an ad-hoc query interface over the local SQLite collection. Queries are expressed in a lightweight SQL-ish DSL and run entirely locally with no API calls. Output is tabular text (pipe-clean) or JSON.

## Usage

```bash
discogs-cli collection query '<query>'
discogs-cli collection query '<query>' --json
```

## Query Grammar

```
query      = entity [select] ['where' conditions] ['group by' fields] ['order by' order] ['limit' N]
entity     = 'releases' | 'tracks' | 'artists'
select     = field_or_agg (',' field_or_agg)*
field_or_agg = fieldname | aggfunc '(' fieldname ')' | 'count()'
conditions = condition ('and' condition)*
condition  = fieldname operator value
operator   = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | 'contains'
```

## Entities

### `releases`
One row per release in the collection.

| Field    | Description                         | Type       |
|----------|-------------------------------------|------------|
| title    | Release title                       | text       |
| artist   | Artist(s) string                    | text       |
| year     | Release year                        | number     |
| genre    | Genre(s), comma-separated           | multi_text |
| style    | Style(s), comma-separated           | multi_text |
| label    | Label(s), comma-separated           | multi_text |
| rating   | Your rating (1–5, nullable)         | number     |
| added    | Date added to collection (YYYY-MM-DD) | date    |

### `tracks`
One row per track. Inherits most fields from the parent release.

| Field    | Description                                  |
|----------|----------------------------------------------|
| title    | Track title                                  |
| artist   | Track artist if set, otherwise release artist |
| position | Track position (e.g. A1)                     |
| duration | Duration string (e.g. 3:45)                  |
| release  | Parent release title                         |
| year, genre, style, label, added | Inherited from release |

### `artists`
Virtual entity — synthesized by splitting the comma-separated `artists` column in `releases`. One row per unique artist name.

| Field    | Description                                  |
|----------|----------------------------------------------|
| name     | Artist name                                  |
| releases | Number of releases this artist appears on    |
| genres   | Comma-separated genres across all releases   |
| styles   | Comma-separated styles across all releases   |

## Operators

| Operator  | Meaning                                      | Applicable to       |
|-----------|----------------------------------------------|---------------------|
| `=`       | Exact match                                  | text, number        |
| `!=`      | Not equal                                    | text, number        |
| `>` `<` `>=` `<=` | Numeric comparison                | number              |
| `~`       | Case-insensitive substring (LIKE %value%)    | text                |
| `contains`| Whole-value match in comma-separated field   | multi_text          |

### `contains` precision
For `releases` and `tracks`, `contains` matches whole comma-separated values. The condition `genre contains 'Jazz'` will match `"Jazz"` and `"Jazz, Funk / Soul"` but **not** `"Jazz-Funk"`. It expands to a 4-condition SQL OR:
```sql
(r.genres = ? OR r.genres LIKE ? OR r.genres LIKE ? OR r.genres LIKE ?)
-- params: 'Jazz', 'Jazz,%', '%, Jazz', '%, Jazz,%'
```

For the `artists` entity, `contains` uses `LIKE '%value%'` which is less precise (substring match).

## Multi-value field expansion in `group by`

When a `multi_text` field (`genre`, `style`, `label`) appears in `group by`, values are automatically expanded. A release with `styles = "Hard Bop, Cool Jazz"` contributes one count to **Hard Bop** and one count to **Cool Jazz** — not to the combined string.

```
releases count(), style group by style order by count desc
```

This uses a recursive CTE under the hood to split the comma-separated column before grouping.

`WHERE` conditions on the expanded field are applied **before** expansion — they filter which releases are included, then all individual values of those releases are counted:

```
# Styles found among Jazz releases
releases count(), style where genre contains 'Jazz' group by style order by count desc
```

### AND combination filter

To find releases that have two specific styles simultaneously, use multiple `contains` conditions:

```
releases title, year where style contains 'Techno' and style contains 'Jungle'
```

## Aggregation

Supported functions: `count()`, `min(field)`, `max(field)`, `avg(field)`, `sum(field)`.

Column aliases: `count()` → `count`, `min(year)` → `min_year`, `avg(rating)` → `avg_rating`.

When any aggregation is present, non-aggregated fields must appear in `group by`.

## Examples

```bash
# Breakdown by individual genre (each genre counted separately)
discogs-cli collection query 'releases count(), genre group by genre order by count desc'

# Breakdown by genre
discogs-cli collection query 'releases count(), genre group by genre order by count desc'

# Top-rated Jazz releases
discogs-cli collection query "releases title, artist, year where genre contains 'Jazz' and rating = 5 order by year"

# Tracks for an artist
discogs-cli collection query "tracks title, release where artist ~ 'Miles Davis' order by release"

# Artists sorted by release count
discogs-cli collection query 'artists name, releases, genres order by releases desc'

# JSON output
discogs-cli collection query 'releases title, year limit 10' --json
```

## Architecture

The pipeline is: **parse → validate → build → execute → format**

| Stage      | File                                  | Responsibility |
|------------|---------------------------------------|----------------|
| Parse      | `src/services/query/parser.ts`        | Tokenizes and produces a `QueryAST` |
| Validate   | `src/services/query/schema.ts`        | Checks entity/field names, operator compatibility |
| Build      | `src/services/query/builder.ts`       | Generates parameterized SQL + column list |
| Execute    | `src/services/query/executor.ts`      | Runs SQL via `DatabaseManager.rawQuery()` |
| Format     | `src/services/query/formatter.ts`     | Tabular or JSON output |
| Command    | `src/commands/query.ts`               | Wires pipeline, handles errors, prints to stdout |

### Multi-value field expansion
When `group by` includes a `multi_text` field, the builder generates a recursive split CTE (e.g. `style_split`) that produces `(release_id, val)` pairs — one per individual value in the comma-separated column. The FROM clause is rewritten to join through this CTE. `WHERE` conditions always reference the original `r.*` column so they filter on the pre-expanded data. The split field's column expression becomes `s.val` in SELECT and GROUP BY.

### Artists virtual entity
Implemented as a recursive CTE that splits `releases.artists` (comma-separated) into individual rows, then aggregates release counts and genre/style lists per artist name.

### Date fields
The `added` field uses `date(r.addedAt)` in all SQL expressions (SELECT, WHERE, GROUP BY) to normalize datetime values to date strings for consistent grouping.

## Error Handling

- **`QueryParseError`** — includes `position` (offset in input string) and `expected` (human-readable description of what was expected). The command prints a caret (`^`) under the offending position.
- **`SchemaValidationError`** — unknown entity or field names include suggestions (nearest known name). Operator mismatches (e.g. `contains` on a non-multi_text field) are reported with field type info.
