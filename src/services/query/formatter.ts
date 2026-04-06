import { QueryResult } from './executor';

export interface FormatOptions {
  json: boolean;
  isTTY: boolean;
}

export function formatResult(result: QueryResult, options: FormatOptions): string {
  if (options.json) {
    return JSON.stringify(result.rows, null, 2);
  }

  const { columns, rows } = result;

  if (rows.length === 0) {
    return columns.join('  ');
  }

  // Single pass: compute column widths and detect numeric columns together
  const widths: number[] = columns.map(col => col.length);
  const seenNonNull = new Set<string>();
  const numericCols = new Set<string>();

  for (const row of rows) {
    columns.forEach((col, i) => {
      const val = row[col];
      if (val !== null) {
        const len = String(val).length;
        if (len > widths[i]) widths[i] = len;
        if (!seenNonNull.has(col)) {
          seenNonNull.add(col);
          if (typeof val === 'number') numericCols.add(col);
        }
      }
    });
  }

  // All-null columns that look like aggregations are numeric
  for (const col of columns) {
    if (!seenNonNull.has(col) && /^(count|sum|avg|min_|max_)/.test(col)) {
      numericCols.add(col);
    }
  }

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

  for (const row of rows) {
    const line = columns
      .map((col, i) => padCell(row[col], widths[i], numericCols.has(col)))
      .join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}
