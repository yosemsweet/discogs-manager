import { Logger } from './logger';

/**
 * InputSanitizer - Prevents common injection attacks and malicious input
 *
 * Handles:
 * - SQL injection prevention
 * - XSS (Cross-Site Scripting) prevention
 * - Command injection prevention
 * - Path traversal prevention
 * - LDAP injection prevention
 * - Email/URL validation
 * - Unicode normalization
 * - Length constraints
 */
export class InputSanitizer {
  /**
   * Sanitize input for SQL queries
   * Note: Always use parameterized queries - this is defense-in-depth
   */
  static sanitizeSql(input: string): string {
    if (!input) return '';

    // Remove potentially dangerous SQL keywords in sequence
    let sanitized = input
      .replace(/['";]/g, '') // Remove quotes and semicolons
      .replace(/--/g, '') // Remove SQL comments
      .replace(/\/\*/g, '') // Remove multi-line comment start
      .replace(/\*\//g, '') // Remove multi-line comment end
      .replace(/xp_/gi, '') // Remove extended stored procedures
      .replace(/sp_/gi, '') // Remove system stored procedures
      .replace(/(drop|delete|insert|update|union|select|exec|execute)\s+/gi, ''); // Remove SQL keywords

    return sanitized.trim();
  }

  /**
   * Sanitize input for HTML/XSS prevention
   */
  static sanitizeHtml(input: string): string {
    if (!input) return '';

    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Sanitize input for command-line execution
   * Removes shell metacharacters
   */
  static sanitizeCommand(input: string): string {
    if (!input) return '';

    const dangerousChars = /[;&|`$(){}[\]<>\\\/'"-]/g;
    return input.replace(dangerousChars, '');
  }

  /**
   * Sanitize file paths to prevent directory traversal
   */
  static sanitizePath(input: string): string {
    if (!input) return '';

    // Remove null bytes
    let sanitized = input.replace(/\0/g, '');

    // Remove path traversal attempts
    sanitized = sanitized.replace(/\.\./g, '');
    sanitized = sanitized.replace(/\/\//g, '/');

    // Remove leading slashes (prevent absolute path)
    sanitized = sanitized.replace(/^\/+/, '');

    // Remove Windows drive letters
    sanitized = sanitized.replace(/^[a-zA-Z]:/g, '');

    return sanitized.trim();
  }

  /**
   * Validate and sanitize email addresses
   */
  static sanitizeEmail(input: string): string | null {
    if (!input) return null;

    const email = input.trim().toLowerCase();

    // RFC 5322 simplified email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email) && email.length <= 254;

    if (!isValid) {
      Logger.warn('Invalid email format', { email });
      return null;
    }

    return email;
  }

  /**
   * Validate and sanitize URLs
   */
  static sanitizeUrl(input: string): string | null {
    if (!input) return null;

    try {
      const url = new URL(input);

      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(url.protocol)) {
        Logger.warn('Invalid URL protocol', { protocol: url.protocol });
        return null;
      }

      return url.toString();
    } catch (error) {
      Logger.warn('Invalid URL format', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Sanitize LDAP input to prevent LDAP injection
   */
  static sanitizeLdap(input: string): string {
    if (!input) return '';

    // LDAP special characters that need escaping
    const ldapEscapeChars: Record<string, string> = {
      '*': '\\2a',
      '(': '\\28',
      ')': '\\29',
      '\\': '\\5c',
      '\0': '\\00',
      '/': '\\2f',
    };

    return input
      .split('')
      .map((char) => ldapEscapeChars[char] || char)
      .join('');
  }

  /**
   * Trim and normalize string input
   */
  static normalizeString(input: string, maxLength?: number): string {
    if (!input) return '';

    let normalized = input.trim();

    // Remove null bytes
    normalized = normalized.replace(/\0/g, '');

    // Normalize whitespace (collapse multiple spaces)
    normalized = normalized.replace(/\s+/g, ' ');

    // Enforce max length
    if (maxLength && normalized.length > maxLength) {
      normalized = normalized.substring(0, maxLength);
      Logger.warn('Input truncated to max length', { maxLength });
    }

    return normalized;
  }

  /**
   * Validate numeric input
   */
  static sanitizeNumber(
    input: string | number,
    options?: {
      min?: number;
      max?: number;
      isInteger?: boolean;
    }
  ): number | null {
    const num = typeof input === 'string' ? parseFloat(input) : input;

    if (isNaN(num)) {
      Logger.warn('Invalid numeric input', { input });
      return null;
    }

    if (options?.isInteger && !Number.isInteger(num)) {
      Logger.warn('Expected integer', { input: num });
      return null;
    }

    if (options?.min !== undefined && num < options.min) {
      Logger.warn('Number below minimum', { num, min: options.min });
      return null;
    }

    if (options?.max !== undefined && num > options.max) {
      Logger.warn('Number above maximum', { num, max: options.max });
      return null;
    }

    return num;
  }

  /**
   * Validate and sanitize array of strings
   */
  static sanitizeStringArray(
    input: string[],
    options?: {
      maxLength?: number;
      maxItems?: number;
      lowercase?: boolean;
    }
  ): string[] {
    if (!Array.isArray(input)) {
      Logger.warn('Expected array input');
      return [];
    }

    let items = input
      .filter((item) => typeof item === 'string' && item.length > 0)
      .map((item) => this.normalizeString(item, options?.maxLength));

    if (options?.lowercase) {
      items = items.map((item) => item.toLowerCase());
    }

    if (options?.maxItems && items.length > options.maxItems) {
      Logger.warn('Array truncated to max items', {
        maxItems: options.maxItems,
      });
      items = items.slice(0, options.maxItems);
    }

    return items;
  }

  /**
   * Sanitize object keys to prevent prototype pollution
   */
  static sanitizeObject<T extends Record<string, unknown>>(
    input: T,
    allowedKeys?: string[]
  ): Partial<T> {
    if (typeof input !== 'object' || input === null) {
      return {};
    }

    const dangerous = ['__proto__', 'constructor', 'prototype'];
    const sanitized: Record<string, unknown> = Object.create(null); // Prevent prototype access

    for (const [key, value] of Object.entries(input)) {
      // Skip dangerous keys
      if (dangerous.includes(key)) {
        Logger.warn('Blocked dangerous object key', { key });
        continue;
      }

      // Skip keys not in allowlist (if provided)
      if (allowedKeys && !allowedKeys.includes(key)) {
        Logger.warn('Key not in allowlist', { key });
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized as Partial<T>;
  }

  /**
   * Validate Discogs release ID format
   */
  static sanitizeDiscogsId(input: string | number): number | null {
    const id = this.sanitizeNumber(input, {
      isInteger: true,
      min: 1,
    });

    if (id === null || id > 999999999) {
      Logger.warn('Invalid Discogs ID format', { input });
      return null;
    }

    return id;
  }

  /**
   * Validate SoundCloud user ID format
   */
  static sanitizeSoundCloudId(input: string | number): number | null {
    const id = this.sanitizeNumber(input, {
      isInteger: true,
      min: 1,
    });

    if (id === null || id > 999999999999) {
      Logger.warn('Invalid SoundCloud ID format', { input });
      return null;
    }

    return id;
  }

  /**
   * Validate playlist name
   */
  static sanitizePlaylistName(input: string, maxLength: number = 200): string | null {
    if (!input) {
      Logger.warn('Invalid playlist name length', {
        length: 0,
        maxLength,
      });
      return null;
    }

    const normalized = input.trim();
    if (normalized.length === 0 || normalized.length > maxLength) {
      Logger.warn('Invalid playlist name length', {
        length: normalized.length,
        maxLength,
      });
      return null;
    }

    return normalized;
  }

  /**
   * Validate search query
   */
  static sanitizeSearchQuery(input: string, maxLength: number = 500): string | null {
    const sanitized = this.normalizeString(input, maxLength);

    if (sanitized.length === 0) {
      Logger.warn('Empty search query');
      return null;
    }

    // Remove potentially dangerous search operators
    const cleaned = sanitized
      .replace(/[\*\(\)]/g, '') // Remove wildcards and parens
      .replace(/--/g, '') // Remove SQL comments
      .replace(/;/g, ''); // Remove semicolons

    return cleaned;
  }

  /**
   * Check if input contains suspicious patterns
   */
  static isSuspicious(input: string): boolean {
    if (!input) return false;

    const suspiciousPatterns = [
      /union\s+select/gi, // SQL injection
      /insert\s+into/gi, // SQL injection
      /delete\s+from/gi, // SQL injection
      /drop\s+table/gi, // SQL injection
      /<script/gi, // XSS
      /javascript:/gi, // XSS
      /onerror\s*=/gi, // XSS
      /onload\s*=/gi, // XSS
      /\.\.\//g, // Path traversal
      /eval\s*\(/gi, // Code injection
      /exec\s*\(/gi, // Command injection
      /system\s*\(/gi, // Command injection
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(input));
  }
}

/**
 * OutputSanitizer - Sanitizes data before display/logging
 *
 * Handles:
 * - Log injection prevention
 * - Special character escaping
 * - Safe JSON serialization
 * - Error message sanitization
 */
export class OutputSanitizer {
  /**
   * Escape special characters in log output
   */
  static escapeLog(input: string): string {
    if (!input) return '';

    // Remove ANSI escape codes that could hide log injection
    let escaped = input.replace(/\x1B\[\d+m/g, '');

    // Remove null bytes
    escaped = escaped.replace(/\0/g, '');

    // Escape newlines and carriage returns (could break log lines)
    escaped = escaped
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    return escaped;
  }

  /**
   * Safe JSON serialization
   */
  static safeJsonStringify(
    obj: unknown,
    options?: {
      maxDepth?: number;
      maxLength?: number;
      excludeKeys?: string[];
    }
  ): string {
    const excludeKeys = options?.excludeKeys || [
      'password',
      'token',
      'secret',
      'apiKey',
      'refreshToken',
      'accessToken',
    ];
    const maxDepth = options?.maxDepth || 10;
    const maxLength = options?.maxLength || 10000;

    const seen = new Set<unknown>();
    let length = 0;

    const replacer = (key: string, value: unknown, depth: number = 0): unknown => {
      // Prevent circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      // Prevent deep nesting
      if (depth > maxDepth) {
        return '[Too Deep]';
      }

      // Exclude sensitive keys
      if (excludeKeys.includes(key)) {
        return '[REDACTED]';
      }

      // Limit string length
      if (typeof value === 'string') {
        length += value.length;
        if (length > maxLength) {
          return '[Truncated]';
        }
      }

      return value;
    };

    try {
      const json = JSON.stringify(obj, (key: string, value: unknown) =>
        replacer(key, value, 0)
      );

      // Final length check
      if (json.length > maxLength) {
        return JSON.stringify({
          message: 'Output too large',
          length: json.length,
          maxLength,
        });
      }

      return json;
    } catch (error) {
      return JSON.stringify({
        error: 'Failed to serialize',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sanitize error messages for display
   */
  static sanitizeErrorMessage(error: Error | unknown): string {
    if (error instanceof Error) {
      // Remove paths and sensitive info from error message
      let message = error.message;

      // Remove file paths - matches /path/to/file or /word
      message = message.replace(/\/[\w/.\-]+/g, '[PATH]');
      // Remove Windows paths
      message = message.replace(/\\[\w\\\-]+/g, '[PATH]');

      // Remove potential secrets (JWT, tokens)
      message = this.redactSensitive(message);

      return this.escapeLog(message);
    }

    return this.escapeLog(String(error));
  }

  /**
   * Redact sensitive data from strings
   */
  static redactSensitive(input: string): string {
    if (!input) return '';

    return input
      .replace(/\b(token|password|secret|api[_-]?key|apikey)\s*[:=]\s*"?[^\s,;}\]"]*"?/gi, '$1: [REDACTED]')
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
      .replace(/authorization:\s*\[REDACTED\]\s+.+/gi, 'authorization: [REDACTED]')
      .replace(/eyJ[\w\-.]+/g, '[REDACTED]');
  }

  /**
   * Truncate long strings safely
   */
  static truncate(input: string, maxLength: number = 200): string {
    if (!input || input.length <= maxLength) return input;

    return input.substring(0, maxLength) + '...';
  }

  /**
   * Format output for display (no special chars, readable)
   */
  static formatForDisplay(input: unknown, maxLength: number = 500): string {
    let str = '';

    if (input === null) {
      str = 'null';
    } else if (input === undefined) {
      str = 'undefined';
    } else if (typeof input === 'string') {
      str = input;
    } else if (typeof input === 'object') {
      str = this.safeJsonStringify(input, { maxLength });
    } else {
      str = String(input);
    }

    return this.truncate(this.escapeLog(str), maxLength);
  }
}
