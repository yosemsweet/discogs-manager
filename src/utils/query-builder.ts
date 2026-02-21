import Database from 'better-sqlite3';

/**
 * Query builder interface for fluent SQL construction
 */
export interface IQueryBuilder {
  select(columns: string[]): IQueryBuilder;
  from(table: string): IQueryBuilder;
  where(condition: string, params?: any[]): IQueryBuilder;
  andWhere(condition: string, params?: any[]): IQueryBuilder;
  orWhere(condition: string, params?: any[]): IQueryBuilder;
  orderBy(column: string, direction?: 'ASC' | 'DESC'): IQueryBuilder;
  limit(limit: number): IQueryBuilder;
  offset(offset: number): IQueryBuilder;
  build(): { sql: string; params: any[] };
}

/**
 * Fluent query builder for SQLite with prepared statement support
 * Enables safe, readable SQL construction without string concatenation
 */
export class QueryBuilder implements IQueryBuilder {
  private selectedColumns: string[] = [];
  private fromTable: string = '';
  private whereClauses: Array<{ condition: string; params: any[] }> = [];
  private orderByClauses: string[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  /**
   * Specify columns to SELECT
   * @param columns Column names or use ['*'] for all
   */
  select(columns: string[]): IQueryBuilder {
    this.selectedColumns = columns;
    return this;
  }

  /**
   * Specify FROM table
   * @param table Table name
   */
  from(table: string): IQueryBuilder {
    this.fromTable = table;
    return this;
  }

  /**
   * Add a WHERE clause
   * @param condition WHERE condition (use ? for parameters)
   * @param params Optional parameters for prepared statement
   */
  where(condition: string, params?: any[]): IQueryBuilder {
    this.whereClauses = [{ condition, params: params || [] }];
    return this;
  }

  /**
   * Add AND WHERE clause
   * @param condition AND condition (use ? for parameters)
   * @param params Optional parameters for prepared statement
   */
  andWhere(condition: string, params?: any[]): IQueryBuilder {
    this.whereClauses.push({ condition, params: params || [] });
    return this;
  }

  /**
   * Add OR WHERE clause
   * @param condition OR condition (use ? for parameters)
   * @param params Optional parameters for prepared statement
   */
  orWhere(condition: string, params?: any[]): IQueryBuilder {
    if (this.whereClauses.length === 0) {
      this.whereClauses.push({ condition, params: params || [] });
    } else {
      // Wrap previous conditions in parentheses and add OR
      const lastClause = this.whereClauses[this.whereClauses.length - 1];
      lastClause.condition = `(${lastClause.condition}) OR (${condition})`;
      lastClause.params = [...lastClause.params, ...(params || [])];
    }
    return this;
  }

  /**
   * Add ORDER BY clause
   * @param column Column name
   * @param direction ASC or DESC (default: ASC)
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): IQueryBuilder {
    this.orderByClauses.push(`${column} ${direction}`);
    return this;
  }

  /**
   * Add LIMIT clause
   * @param limit Maximum rows to return
   */
  limit(limit: number): IQueryBuilder {
    this.limitValue = limit;
    return this;
  }

  /**
   * Add OFFSET clause
   * @param offset Row offset
   */
  offset(offset: number): IQueryBuilder {
    this.offsetValue = offset;
    return this;
  }

  /**
   * Build the SQL query and collect all parameters
   * @returns Object with sql string and params array
   */
  build(): { sql: string; params: any[] } {
    if (!this.fromTable) {
      throw new Error('QueryBuilder: FROM table must be specified');
    }

    let sql = `SELECT ${this.selectedColumns.join(', ')} FROM ${this.fromTable}`;
    let params: any[] = [];

    // Add WHERE clauses
    if (this.whereClauses.length > 0) {
      const whereConditions = this.whereClauses.map(clause => {
        params.push(...clause.params);
        return clause.condition;
      });
      sql += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    // Add ORDER BY
    if (this.orderByClauses.length > 0) {
      sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
    }

    // Add LIMIT
    if (this.limitValue !== null) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    // Add OFFSET
    if (this.offsetValue !== null) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return { sql, params };
  }

  /**
   * Reset the builder to initial state
   */
  reset(): void {
    this.selectedColumns = [];
    this.fromTable = '';
    this.whereClauses = [];
    this.orderByClauses = [];
    this.limitValue = null;
    this.offsetValue = null;
  }
}

/**
 * Database transaction helper
 * Executes a function within a transaction (BEGIN/COMMIT/ROLLBACK)
 */
export class TransactionManager {
  constructor(private db: Database.Database) {}

  /**
   * Execute a function within a transaction
   * Automatically commits on success or rolls back on error
   * @param callback Function to execute within transaction
   * @returns Result of callback function
   */
  transaction<T>(callback: () => T): T {
    const transaction = this.db.transaction(callback);
    return transaction();
  }

  /**
   * Execute multiple statements atomically
   * All must succeed or all are rolled back
   * @param statements Array of {sql, params} objects
   * @returns Array of results
   */
  batch(statements: Array<{ sql: string; params?: any[] }>): any[] {
    return this.transaction(() => {
      return statements.map(stmt => {
        const prepared = this.db.prepare(stmt.sql);
        return prepared.run(...(stmt.params || []));
      });
    });
  }
}

/**
 * Common query helpers using QueryBuilder
 */
export class CommonQueries {
  /**
   * Build a SELECT * query
   */
  static selectAll(table: string): { sql: string; params: any[] } {
    return new QueryBuilder().select(['*']).from(table).build();
  }

  /**
   * Build a SELECT with single WHERE condition
   */
  static selectWhere(
    table: string,
    column: string,
    value: any
  ): { sql: string; params: any[] } {
    return new QueryBuilder()
      .select(['*'])
      .from(table)
      .where(`${column} = ?`, [value])
      .build();
  }

  /**
   * Build a SELECT with LIMIT
   */
  static selectLimit(
    table: string,
    limit: number,
    orderBy?: string,
    direction?: 'ASC' | 'DESC'
  ): { sql: string; params: any[] } {
    const qb = new QueryBuilder().select(['*']).from(table).limit(limit);
    if (orderBy) {
      qb.orderBy(orderBy, direction);
    }
    return qb.build();
  }

  /**
   * Build a count query
   */
  static count(table: string): { sql: string; params: any[] } {
    return new QueryBuilder().select(['COUNT(*) as count']).from(table).build();
  }

  /**
   * Build a count query with WHERE condition
   */
  static countWhere(table: string, column: string, value: any): { sql: string; params: any[] } {
    return new QueryBuilder()
      .select(['COUNT(*) as count'])
      .from(table)
      .where(`${column} = ?`, [value])
      .build();
  }

  /**
   * Build pagination query
   */
  static paginate(
    table: string,
    page: number,
    pageSize: number,
    orderBy?: string,
    direction?: 'ASC' | 'DESC'
  ): { sql: string; params: any[] } {
    const offset = (page - 1) * pageSize;
    const qb = new QueryBuilder().select(['*']).from(table).limit(pageSize).offset(offset);

    if (orderBy) {
      qb.orderBy(orderBy, direction);
    }

    return qb.build();
  }

  /**
   * Build a LIKE search query
   */
  static search(
    table: string,
    column: string,
    searchTerm: string,
    limit?: number
  ): { sql: string; params: any[] } {
    const qb = new QueryBuilder()
      .select(['*'])
      .from(table)
      .where(`${column} LIKE ?`, [`%${searchTerm}%`]);

    if (limit) {
      qb.limit(limit);
    }

    return qb.build();
  }
}
