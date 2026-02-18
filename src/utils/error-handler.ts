import { AxiosError } from 'axios';
import { Logger } from './logger';

/**
 * Centralized error handling and categorization
 * Provides consistent error types and logging across API and service layers
 */

export enum ErrorType {
  // HTTP Client Errors (4xx)
  BadRequest = 'BadRequest',
  Unauthorized = 'Unauthorized',
  Forbidden = 'Forbidden',
  NotFound = 'NotFound',
  Conflict = 'Conflict',
  UnprocessableEntity = 'UnprocessableEntity',

  // Rate Limiting (429)
  RateLimit = 'RateLimit',

  // HTTP Server Errors (5xx)
  InternalServerError = 'InternalServerError',
  ServiceUnavailable = 'ServiceUnavailable',
  BadGateway = 'BadGateway',

  // Network Errors
  NetworkError = 'NetworkError',
  Timeout = 'Timeout',

  // Application Errors
  ValidationError = 'ValidationError',
  ConfigurationError = 'ConfigurationError',
  DatabaseError = 'DatabaseError',
  NotImplemented = 'NotImplemented',

  // Unknown
  Unknown = 'Unknown',
}

export interface ErrorContext {
  operation: string;
  resource?: string;
  details?: Record<string, any>;
}

/**
 * Base application error with type and context information
 */
export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public statusCode?: number,
    public originalError?: any,
    public context?: ErrorContext
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Check if error is retryable
   * (temporary failures that may succeed on retry)
   */
  isRetryable(): boolean {
    return [
      ErrorType.RateLimit,
      ErrorType.ServiceUnavailable,
      ErrorType.BadGateway,
      ErrorType.Timeout,
      ErrorType.NetworkError,
    ].includes(this.type);
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const contextStr = this.context ? ` (${this.context.operation})` : '';

    switch (this.type) {
      case ErrorType.RateLimit:
        return `Rate limit exceeded. Please try again later.${contextStr}`;
      case ErrorType.Unauthorized:
      case ErrorType.Forbidden:
        return `Authentication failed. Please check your credentials.${contextStr}`;
      case ErrorType.NotFound:
        return `Resource not found.${contextStr}`;
      case ErrorType.ValidationError:
        return `Invalid input. ${this.message}${contextStr}`;
      case ErrorType.NetworkError:
        return `Network error. Please check your connection.${contextStr}`;
      case ErrorType.Timeout:
        return `Request timed out. Please try again.${contextStr}`;
      case ErrorType.ServiceUnavailable:
      case ErrorType.BadGateway:
      case ErrorType.InternalServerError:
        return `Service temporarily unavailable. Please try again later.${contextStr}`;
      case ErrorType.DatabaseError:
        return `Database error. Please try again.${contextStr}`;
      default:
        return `Error: ${this.message}${contextStr}`;
    }
  }

  /**
   * Convert to JSON for logging
   */
  toJSON() {
    return {
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
      isRetryable: this.isRetryable(),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Error handler utility for consistent error processing
 */
export class ErrorHandler {
  /**
   * Parse and categorize an error into AppError
   * Handles Axios errors, generic Error objects, and unknown types
   */
  static parse(error: any, context: ErrorContext): AppError {
    // Already an AppError - just add context if missing
    if (error instanceof AppError) {
      return new AppError(
        error.type,
        error.message,
        error.statusCode,
        error.originalError,
        context || error.context
      );
    }

    // Axios error - has HTTP status information
    if (error?.response) {
      return this.parseAxiosError(error as AxiosError, context);
    }

    // Standard Error object
    if (error instanceof Error) {
      return this.parseStandardError(error, context);
    }

    // Unknown type
    return new AppError(
      ErrorType.Unknown,
      String(error),
      undefined,
      error,
      context
    );
  }

  /**
   * Parse Axios error into AppError with HTTP status categorization
   */
  private static parseAxiosError(error: AxiosError, context: ErrorContext): AppError {
    const status = error.response?.status;
    const data = (error.response?.data as any) || {};
    const errorMsg = data?.error_description || data?.message || error.message;

    // Determine error type from status code
    let type: ErrorType;
    switch (status) {
      case 400:
        type = ErrorType.BadRequest;
        break;
      case 401:
        type = ErrorType.Unauthorized;
        break;
      case 403:
        type = ErrorType.Forbidden;
        break;
      case 404:
        type = ErrorType.NotFound;
        break;
      case 409:
        type = ErrorType.Conflict;
        break;
      case 422:
        type = ErrorType.UnprocessableEntity;
        break;
      case 429:
        type = ErrorType.RateLimit;
        break;
      case 500:
        type = ErrorType.InternalServerError;
        break;
      case 502:
        type = ErrorType.BadGateway;
        break;
      case 503:
        type = ErrorType.ServiceUnavailable;
        break;
      case undefined:
        // Network error or timeout
        if (error.message.includes('timeout')) {
          type = ErrorType.Timeout;
        } else {
          type = ErrorType.NetworkError;
        }
        break;
      default:
        type = ErrorType.Unknown;
    }

    return new AppError(
      type,
      errorMsg || `HTTP ${status}: ${error.message}`,
      status,
      error,
      context
    );
  }

  /**
   * Parse standard Error object
   * Look for common patterns in error messages
   */
  private static parseStandardError(error: Error, context: ErrorContext): AppError {
    const msg = error.message.toLowerCase();

    let type: ErrorType = ErrorType.Unknown;

    if (msg.includes('timeout')) {
      type = ErrorType.Timeout;
    } else if (msg.includes('network') || msg.includes('econnrefused')) {
      type = ErrorType.NetworkError;
    } else if (msg.includes('validation') || msg.includes('invalid')) {
      type = ErrorType.ValidationError;
    } else if (msg.includes('database')) {
      type = ErrorType.DatabaseError;
    } else if (msg.includes('configuration') || msg.includes('not set')) {
      type = ErrorType.ConfigurationError;
    }

    return new AppError(type, error.message, undefined, error, context);
  }

  /**
   * Log an error with context information
   * Respects error severity (retryable vs permanent)
   */
  static log(error: AppError, severity: 'error' | 'warn' | 'info' = 'error'): void {
    const baseMsg = `[${error.context?.operation || 'unknown'}] ${error.message}`;

    if (severity === 'error') {
      Logger.error(baseMsg);
    } else if (severity === 'warn') {
      Logger.warn(baseMsg);
    } else {
      Logger.info(baseMsg);
    }

    // Log details for debugging
    if (error.context?.details) {
      Logger.debug(`Details: ${JSON.stringify(error.context.details)}`);
    }

    // Log if retryable
    if (error.isRetryable()) {
      Logger.info(`Error is retryable. Will attempt retry.`);
    }
  }

  /**
   * Wrap a function to automatically handle and transform errors
   * Useful for service methods that should consistently throw AppError
   */
  static async wrapAsync<T>(
    fn: () => Promise<T>,
    context: ErrorContext
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const appError = this.parse(error, context);
      this.log(appError, appError.isRetryable() ? 'warn' : 'error');
      throw appError;
    }
  }

  /**
   * Execute with retry logic for transient errors
   * Uses exponential backoff for wait times
   */
  static async retryAsync<T>(
    fn: () => Promise<T>,
    context: ErrorContext,
    maxRetries: number = 3,
    initialDelayMs: number = 1000
  ): Promise<T> {
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.wrapAsync(fn, context);
      } catch (error) {
        lastError = error as AppError;

        // Don't retry if error is not retryable
        if (!lastError.isRetryable()) {
          throw lastError;
        }

        // Don't wait after final attempt
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s, etc.
        const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
        Logger.warn(
          `Retry attempt ${attempt}/${maxRetries} for ${context.operation}. ` +
          `Waiting ${(delayMs / 1000).toFixed(1)}s before retry...`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted
    if (lastError) {
      Logger.error(
        `All ${maxRetries} retry attempts failed for ${context.operation}. ` +
        `Final error: ${lastError.message}`
      );
      throw lastError;
    }

    throw new AppError(ErrorType.Unknown, 'Unknown error in retry loop', undefined, null, context);
  }
}
