import { DatabaseManager } from '../database';
import { BuiltQuery } from './builder';

export interface QueryResult {
  columns: string[];
  rows: Record<string, string | number | null>[];
}

export async function executeQuery(db: DatabaseManager, built: BuiltQuery): Promise<QueryResult> {
  const rawRows = await db.rawQuery(built.sql, built.params);

  const rows = rawRows.map(row => {
    const result: Record<string, string | number | null> = {};
    for (const col of built.columns) {
      const val = row[col];
      if (val === null || val === undefined) {
        result[col] = null;
      } else if (typeof val === 'number') {
        result[col] = val;
      } else {
        result[col] = String(val);
      }
    }
    return result;
  });

  return { columns: built.columns, rows };
}
