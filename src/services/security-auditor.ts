import { Logger } from '../utils/logger';

/**
 * SecurityAuditor - Audits SQL queries for security vulnerabilities
 *
 * Responsibilities:
 * - Verify parameterized queries are used
 * - Detect dynamic query construction patterns
 * - Check for SQL injection vectors
 * - Validate prepared statement usage
 * - Report suspicious query patterns
 */
export class SecurityAuditor {
  /**
   * Audit a SQL query for potential vulnerabilities
   * Returns true if query is safe, false if vulnerabilities detected
   */
  static auditQuery(query: string): boolean {
    if (!query) {
      Logger.warn('Empty query provided for audit');
      return false;
    }

    // Check for dynamic query construction patterns
    if (this.hasDynamicConstruction(query)) {
      Logger.warn('Detected dynamic query construction', { query: query.slice(0, 100) });
      return false;
    }

    // Check for SQL injection patterns
    if (this.hasSqlInjectionPatterns(query)) {
      Logger.warn('Detected SQL injection patterns', { query: query.slice(0, 100) });
      return false;
    }

    // Check for dangerous SQL keywords in values
    if (this.hasDangerousSqlInValues(query)) {
      Logger.warn('Detected SQL keywords in suspicious positions', { query: query.slice(0, 100) });
      return false;
    }

    return true;
  }

  /**
   * Check if query uses parameterized statements
   * Returns true if query appears to use parameters, false otherwise
   */
  static isParameterized(query: string): boolean {
    // SQLite uses ? for parameters
    // or named parameters like :name, $name, @name
    const paramPattern = /(\?|:\w+|\$\w+|@\w+)/;
    return paramPattern.test(query);
  }

  /**
   * Detect dynamic query construction patterns
   * These indicate strings are being concatenated with SQL
   */
  private static hasDynamicConstruction(query: string): boolean {
    const suspiciousPatterns = [
      /'\s*\+\s*['"]/, // String concatenation with + operator
      /\$\{[^}]+\}/, // Template literals with variables
      /`.*\$\{[^}]+\}.*`/, // Backticks with template variables (outside of params)
      /WHERE\s+\d+\s*=\s*\d+/, // Obvious filler query (1=1 injection test)
      /OR\s+'1'\s*=\s*'1'/, // Classic injection test
      /;\s*(DROP|DELETE|UPDATE|INSERT|EXEC|EXECUTE)/, // Statement chaining
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(query)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect common SQL injection patterns
   */
  private static hasSqlInjectionPatterns(query: string): boolean {
    const injectionPatterns = [
      /--\s*$/, // SQL comment at end
      /\/\*.*?\*\//, // Multi-line comments
      /xp_\w+/, // Extended stored procedures
      /sp_\w+/, // System stored procedures
      /;\s*UNION/i, // Union-based injection
      /;\s*SELECT/i, // Chained select
      /;\s*INSERT/i, // Chained insert
      /;\s*DELETE/i, // Chained delete
      /WAITFOR\s*DELAY/i, // Time-based blind injection
      /BENCHMARK\s*\(/i, // MySQL benchmark for timing
      /SLEEP\s*\(/i, // Sleep function for timing
      /'\s*OR\s*'/, // Single quote OR bypass
      /"\s*OR\s*"/, // Double quote OR bypass
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(query)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for dangerous SQL keywords in unexpected positions
   * (outside of comments or string literals)
   */
  private static hasDangerousSqlInValues(query: string): boolean {
    // Remove quoted strings to check remaining content
    const withoutStrings = query
      .replace(/'[^']*'/g, "''") // Replace single-quoted strings
      .replace(/"[^"]*"/g, '""'); // Replace double-quoted strings

    // Look for dangerous keywords that shouldn't appear in processed queries
    const dangerousPatterns = [
      /UNION\s+ALL\s+SELECT/i,
      /UNION\s+SELECT/i,
      /INTO\s+OUTFILE/i,
      /INTO\s+DUMPFILE/i,
      /LOAD_FILE\s*\(/i,
      /CONCAT\s*\(/i, // Often used in injections
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(withoutStrings)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Audit a prepared statement - check params are provided
   */
  static auditPreparedStatement(query: string, params: unknown[] | Record<string, unknown>): boolean {
    if (!query || !params) {
      Logger.warn('Prepared statement missing query or params');
      return false;
    }

    // Check that query is parameterized
    if (!this.isParameterized(query)) {
      Logger.warn('Non-parameterized statement used', { query: query.slice(0, 100) });
      return false;
    }

    // Check that params are not empty for parameterized query
    const paramCount = Array.isArray(params) ? params.length : Object.keys(params).length;
    if (paramCount === 0) {
      Logger.warn('Parameterized query has no parameters', { query: query.slice(0, 100) });
      return false;
    }

    return this.auditQuery(query);
  }

  /**
   * Validate SQL identifiers (table/column names) are safe
   * Should only contain alphanumeric, underscore, and not be reserved words
   */
  static validateIdentifier(identifier: string): boolean {
    if (!identifier) {
      return false;
    }

    // Check format: alphanumeric + underscore only
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
      Logger.warn('Invalid identifier format', { identifier });
      return false;
    }

    // Check against reserved SQL keywords
    const reservedWords = [
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TABLE',
      'DATABASE', 'INDEX', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'UNION',
      'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT',
      'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'USING', 'AND', 'OR', 'NOT',
      'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'NULL', 'TRUE', 'FALSE', 'AS', 'FROM',
      'VALUES', 'SET', 'PRIMARY', 'KEY', 'FOREIGN', 'CONSTRAINT', 'UNIQUE',
      'CHECK', 'DEFAULT', 'AUTOINCREMENT', 'DESC', 'ASC', 'DISTINCT', 'ALL',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'COLLATE', 'CONSTRAINT',
    ];

    if (reservedWords.includes(identifier.toUpperCase())) {
      Logger.warn('Using reserved SQL keyword as identifier', { identifier });
      return false;
    }

    return true;
  }

  /**
   * Analyze query structure for security issues
   * Returns detailed audit report
   */
  static analyzeQuery(query: string): {
    safe: boolean;
    parameterized: boolean;
    dynamicConstruction: boolean;
    injectionPatterns: boolean;
    message: string;
  } {
    const result = {
      safe: true,
      parameterized: this.isParameterized(query),
      dynamicConstruction: this.hasDynamicConstruction(query),
      injectionPatterns: this.hasSqlInjectionPatterns(query),
      message: 'Query appears safe',
    };

    if (result.dynamicConstruction) {
      result.safe = false;
      result.message = 'Dynamic query construction detected';
    } else if (result.injectionPatterns) {
      result.safe = false;
      result.message = 'SQL injection patterns detected';
    } else if (!result.parameterized) {
      result.safe = false;
      result.message = 'Query is not parameterized';
    }

    return result;
  }

  /**
   * Suggest fixes for detected vulnerabilities
   */
  static suggestFixes(query: string): string[] {
    const suggestions: string[] = [];

    if (!this.isParameterized(query)) {
      suggestions.push('Use parameterized queries with ? placeholders or named parameters');
    }

    if (this.hasDynamicConstruction(query)) {
      suggestions.push('Avoid string concatenation with SQL keywords');
      suggestions.push('Use prepared statements with parameters for all user input');
    }

    if (this.hasSqlInjectionPatterns(query)) {
      suggestions.push('Check for SQL injection vulnerabilities');
      suggestions.push('Sanitize all user inputs before use');
    }

    if (this.hasDangerousSqlInValues(query)) {
      suggestions.push('Review where dangerous SQL keywords appear in the query');
      suggestions.push('Consider if these could be user-controlled input');
    }

    if (suggestions.length === 0) {
      suggestions.push('Query structure appears secure, but always validate inputs');
    }

    return suggestions;
  }

  /**
   * Extract and validate all identifiers from a query
   * Returns list of identifiers found
   */
  static extractIdentifiers(query: string): string[] {
    const identifiers: string[] = [];
    
    // Pattern to match table.column or standalone identifiers after FROM, WHERE, etc.
    // This is a simplified pattern
    const pattern = /(?:FROM|JOIN|INTO|UPDATE|WHERE)\s+(\w+(?:\.\w+)?)/gi;
    let match;

    while ((match = pattern.exec(query)) !== null) {
      identifiers.push(match[1]);
    }

    return identifiers;
  }

  /**
   * Check if all identifiers in query are valid
   */
  static validateQueryIdentifiers(query: string): boolean {
    const identifiers = this.extractIdentifiers(query);

    for (const id of identifiers) {
      // Handle table.column format
      const parts = id.split('.');
      for (const part of parts) {
        if (!this.validateIdentifier(part)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get security score for query (0-100)
   * Higher is better
   */
  static getSecurityScore(query: string): number {
    let score = 100;

    // Deduct for various risk factors
    if (!this.isParameterized(query)) score -= 30;
    if (this.hasDynamicConstruction(query)) score -= 40;
    if (this.hasSqlInjectionPatterns(query)) score -= 50;
    if (this.hasDangerousSqlInValues(query)) score -= 25;

    return Math.max(0, score);
  }
}
