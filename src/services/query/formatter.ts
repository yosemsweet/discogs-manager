import { QueryResult } from './executor';

export interface FormatOptions {
  json: boolean;
  isTTY: boolean;
}

function isNumericColumn(col: string, rows: QueryResult['rows']): boolean {
  for (const row of rows) {
    const val = row[col];
    if (val !== null) return typeof val === 'number';
  }
  // No non-null values: treat as numeric if it looks like an aggregation result
  return /^(count|sum|avg|min_|max_|count_|sum_|avg_)/.test(col);
}

export function formatResult(result: QueryResult, options: FormatOptions): string {
  if (options.json) {
    return JSON.stringify(result.rows, null, 2);
  }

  const { columns, rows } = result;

  if (rows.length === 0) {
    return columns.join('  ');
  }

  // Calculate column widths: max of header length and all value lengths
  const widths: number[] = columns.map(col => col.length);
  for (const row of rows) {
    columns.forEach((col, i) => {
      const val = row[col];
      const len = val === null ? 0 : String(val).length;
      if (len > widths[i]) widths[i] = len;
    });
  }

  const numericCols = new Set(columns.filter(col => isNumericColumn(col, rows)));

  const padCell = (val: string | number | null, width: number, numeric: boolean): string => {
    const str = val === null ? '' : String(val);
    return numeric ? str.padStart(width) : str.padEnd(width);
  };

  const lines: string[] = [];

  // Header row — match alignment of data
  const header = columns
    .map((col, i) => numericCols.has(col) ? col.padStart(widths[i]) : col.padEnd(widths[i]))
    .join('  ');
  lines.push(header);

  // Data rows
  for (const row of rows) {
    const line = columns
      .map((col, i) => padCell(row[col], widths[i], numericCols.has(col)))
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}
