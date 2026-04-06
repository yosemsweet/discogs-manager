import { QueryAST, SelectItem, Condition, OrderItem, AggFunc } from './parser';
import { getEntityDefinition, getField } from './schema';

export interface BuiltQuery {
  sql: string;
  params: (string | number)[];
  columns: string[];
}

const AGG_SQL: Record<AggFunc, (col: string) => string> = {
  count: (col) => col ? `COUNT(${col})` : 'COUNT(*)',
  min:   (col) => `MIN(${col})`,
  max:   (col) => `MAX(${col})`,
  avg:   (col) => `AVG(${col})`,
  sum:   (col) => `SUM(${col})`,
};

function buildSelectExpression(item: SelectItem, entity: string): { expr: string; alias: string } {
  if (item.type === 'aggregation') {
    const col = item.field ? getField(entity, item.field).column : '';
    const expr = AGG_SQL[item.aggregation](col);
    const alias = item.field ? `${item.aggregation}_${item.field}` : item.aggregation;
    return { expr, alias };
  }
  const fieldDef = getField(entity, item.field);
  return { expr: fieldDef.column, alias: item.field };
}

function buildContainsCondition(column: string, value: string, isVirtual: boolean): { sql: string; params: string[] } {
  // For virtual (artists) entity, use simple LIKE since genres/styles are GROUP_CONCAT'd
  if (isVirtual) {
    return {
      sql: `${column} LIKE ? COLLATE NOCASE`,
      params: [`%${value}%`],
    };
  }
  // 4-condition precise match for comma-separated "val1, val2" fields
  return {
    sql: `(${column} = ? OR ${column} LIKE ? OR ${column} LIKE ? OR ${column} LIKE ?)`,
    params: [value, `${value},%`, `%, ${value}`, `%, ${value},%`],
  };
}

function buildWhereClause(
  conditions: Condition[],
  entity: string,
  isVirtual: boolean,
  params: (string | number)[]
): string {
  if (conditions.length === 0) return '';

  const parts: string[] = [];
  for (const cond of conditions) {
    const fieldDef = getField(entity, cond.field);
    const col = fieldDef.column;

    if (cond.operator === 'contains') {
      const { sql, params: p } = buildContainsCondition(col, String(cond.value), isVirtual);
      parts.push(sql);
      params.push(...p);
    } else if (cond.operator === '~') {
      parts.push(`${col} LIKE ? COLLATE NOCASE`);
      params.push(`%${cond.value}%`);
    } else {
      parts.push(`${col} ${cond.operator} ?`);
      params.push(cond.value);
    }
  }

  return 'WHERE ' + parts.join(' AND ');
}

function buildOrderByClause(
  orderBy: OrderItem[],
  entity: string,
  selectItems: SelectItem[],
  defaultOrderBy: OrderItem[],
  expandedField: string | null
): string {
  const items = orderBy.length > 0 ? orderBy : defaultOrderBy;
  if (items.length === 0) return '';

  const parts: string[] = [];
  for (const item of items) {
    const dir = item.direction.toUpperCase();
    if (item.type === 'aggregation') {
      const matching = selectItems.find(
        s => s.type === 'aggregation' && s.aggregation === item.aggregation
      );
      if (matching) {
        const { alias } = buildSelectExpression(matching, entity);
        parts.push(`${alias} ${dir}`);
      } else {
        parts.push(`${AGG_SQL[item.aggregation]('')} ${dir}`);
      }
    } else {
      const col = (expandedField && item.field === expandedField) ? 's.val' : getField(entity, item.field).column;
      parts.push(`${col} ${dir}`);
    }
  }

  return parts.length > 0 ? 'ORDER BY ' + parts.join(', ') : '';
}

// Generates a recursive CTE that splits a comma-separated column into individual (release_id, val) rows.
function buildSplitCTE(rawColumn: string, fieldName: string): string {
  return `WITH RECURSIVE ${fieldName}_split(release_id, val, rest) AS (
  SELECT discogsId,
    TRIM(CASE WHEN INSTR(${rawColumn}, ',') > 0 THEN SUBSTR(${rawColumn}, 1, INSTR(${rawColumn}, ',')-1) ELSE ${rawColumn} END),
    CASE WHEN INSTR(${rawColumn}, ',') > 0 THEN SUBSTR(${rawColumn}, INSTR(${rawColumn}, ',')+1) ELSE NULL END
  FROM releases
  UNION ALL
  SELECT release_id,
    TRIM(CASE WHEN INSTR(rest, ',') > 0 THEN SUBSTR(rest, 1, INSTR(rest, ',')-1) ELSE rest END),
    CASE WHEN INSTR(rest, ',') > 0 THEN SUBSTR(rest, INSTR(rest, ',')+1) ELSE NULL END
  FROM ${fieldName}_split WHERE rest IS NOT NULL AND TRIM(rest) != ''
)`;
}

function buildArtistsCTE(): string {
  return `WITH RECURSIVE artist_split(name, rest, release_id, genres, styles) AS (
  SELECT
    TRIM(CASE WHEN INSTR(r.artists, ',') > 0 THEN SUBSTR(r.artists, 1, INSTR(r.artists, ',')-1) ELSE r.artists END),
    CASE WHEN INSTR(r.artists, ',') > 0 THEN SUBSTR(r.artists, INSTR(r.artists, ',')+1) ELSE NULL END,
    r.discogsId,
    r.genres,
    r.styles
  FROM releases r
  UNION ALL
  SELECT
    TRIM(CASE WHEN INSTR(rest, ',') > 0 THEN SUBSTR(rest, 1, INSTR(rest, ',')-1) ELSE rest END),
    CASE WHEN INSTR(rest, ',') > 0 THEN SUBSTR(rest, INSTR(rest, ',')+1) ELSE NULL END,
    release_id,
    genres,
    styles
  FROM artist_split
  WHERE rest IS NOT NULL AND TRIM(rest) != ''
),
artist_data AS (
  SELECT
    name,
    COUNT(DISTINCT release_id) AS releases,
    GROUP_CONCAT(DISTINCT genres) AS genres,
    GROUP_CONCAT(DISTINCT styles) AS styles
  FROM artist_split
  WHERE name IS NOT NULL AND name != ''
  GROUP BY name
)`;
}

export function buildQuery(ast: QueryAST): BuiltQuery {
  const entity = getEntityDefinition(ast.entity);
  const params: (string | number)[] = [];
  const isVirtual = !!entity.isVirtual;

  // When a multi_text field appears in GROUP BY, expand it: one row per individual value.
  // WHERE conditions always use the original column (pre-expansion) to filter which releases
  // are included, then all individual values of those releases are counted.
  let expandedField: string | null = null;
  if (!isVirtual) {
    for (const f of ast.groupBy) {
      if (getField(ast.entity, f).type === 'multi_text') { expandedField = f; break; }
    }
  }

  let splitCTE = '';
  let fromClause = entity.fromClause;
  if (expandedField) {
    const rawCol = getField(ast.entity, expandedField).column.replace(/^\w+\./, '');
    splitCTE = buildSplitCTE(rawCol, expandedField);
    if (ast.entity === 'releases') {
      fromClause = `${expandedField}_split s JOIN releases r ON r.discogsId = s.release_id`;
    } else {
      // tracks: add split as extra join
      fromClause = `${entity.fromClause} JOIN ${expandedField}_split s ON s.release_id = r.discogsId`;
    }
  }

  // Determine effective select items
  const selectItems = ast.select.length > 0
    ? ast.select
    : entity.defaultSelect.map<SelectItem>(f => ({ type: 'field', field: f }));

  // Build SELECT clause
  const selectParts: string[] = [];
  const columns: string[] = [];

  for (const item of selectItems) {
    let { expr, alias } = buildSelectExpression(item, ast.entity);
    if (expandedField && item.type === 'field' && item.field === expandedField) {
      expr = 's.val';
    }
    selectParts.push(`${expr} AS ${alias}`);
    columns.push(alias);
  }

  const selectClause = 'SELECT ' + selectParts.join(', ');

  // Build WHERE clause (always references original r.* columns, even for the expanded field)
  const whereClause = buildWhereClause(ast.where, ast.entity, isVirtual, params);
  let effectiveWhere = whereClause;
  if (expandedField) {
    const nullGuard = `s.val IS NOT NULL AND TRIM(s.val) != ''`;
    effectiveWhere = whereClause ? `${whereClause} AND ${nullGuard}` : `WHERE ${nullGuard}`;
  }

  // Build GROUP BY clause
  let groupByClause = '';
  if (ast.groupBy.length > 0) {
    const groupParts = ast.groupBy.map(f =>
      (expandedField && f === expandedField) ? 's.val' : getField(ast.entity, f).column
    );
    groupByClause = 'GROUP BY ' + groupParts.join(', ');
  }

  // Build ORDER BY clause
  const orderByClause = buildOrderByClause(
    ast.orderBy,
    ast.entity,
    selectItems,
    entity.defaultOrderBy,
    expandedField
  );

  // Build LIMIT clause
  const limitClause = ast.limit !== null ? `LIMIT ${ast.limit}` : '';

  // Assemble SQL
  let sql: string;
  if (isVirtual) {
    const cte = buildArtistsCTE();
    const clauses = [selectClause, 'FROM artist_data', whereClause, groupByClause, orderByClause, limitClause]
      .filter(Boolean).join('\n');
    sql = `${cte}\n${clauses}`;
  } else if (splitCTE) {
    const clauses = [selectClause, `FROM ${fromClause}`, effectiveWhere, groupByClause, orderByClause, limitClause]
      .filter(Boolean).join('\n');
    sql = `${splitCTE}\n${clauses}`;
  } else {
    const clauses = [selectClause, `FROM ${entity.fromClause}`, whereClause, groupByClause, orderByClause, limitClause]
      .filter(Boolean).join('\n');
    sql = clauses;
  }

  return { sql, params, columns };
}
