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
  defaultOrderBy: typeof orderBy
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
      const fieldDef = getField(entity, item.field);
      parts.push(`${fieldDef.column} ${dir}`);
    }
  }

  return parts.length > 0 ? 'ORDER BY ' + parts.join(', ') : '';
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

  // Determine effective select items
  const selectItems = ast.select.length > 0
    ? ast.select
    : entity.defaultSelect.map<SelectItem>(f => ({ type: 'field', field: f }));

  // Build SELECT clause
  const selectParts: string[] = [];
  const columns: string[] = [];

  for (const item of selectItems) {
    const { expr, alias } = buildSelectExpression(item, ast.entity);
    selectParts.push(`${expr} AS ${alias}`);
    columns.push(alias);
  }

  const selectClause = 'SELECT ' + selectParts.join(', ');

  // Build WHERE clause
  const whereClause = buildWhereClause(ast.where, ast.entity, isVirtual, params);

  // Build GROUP BY clause
  let groupByClause = '';
  if (ast.groupBy.length > 0) {
    const groupParts = ast.groupBy.map(f => {
      try {
        return getField(ast.entity, f).column;
      } catch {
        return f;
      }
    });
    groupByClause = 'GROUP BY ' + groupParts.join(', ');
  }

  // Build ORDER BY clause
  const orderByClause = buildOrderByClause(
    ast.orderBy,
    ast.entity,
    selectItems,
    entity.defaultOrderBy
  );

  // Build LIMIT clause
  const limitClause = ast.limit !== null ? `LIMIT ${ast.limit}` : '';

  // Assemble SQL
  let sql: string;
  if (isVirtual) {
    // artists: CTE + query on artist_data
    const cte = buildArtistsCTE();
    const clauses = [selectClause, 'FROM artist_data', whereClause, groupByClause, orderByClause, limitClause]
      .filter(Boolean)
      .join('\n');
    sql = `${cte}\n${clauses}`;
  } else {
    const clauses = [selectClause, `FROM ${entity.fromClause}`, whereClause, groupByClause, orderByClause, limitClause]
      .filter(Boolean)
      .join('\n');
    sql = clauses;
  }

  return { sql, params, columns };
}
