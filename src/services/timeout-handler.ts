import { Logger } from '../utils/logger';

/**
 * Configuration for timeout execution
 */
export interface ExecuteOptions {
  timeout: number; // Milliseconds
  operation?: string; // Optional identifier for logging
  onTimeout?: () => void | Promise<void>; // Callback when timeout occurs
  retries?: number; // Number of retries on timeout (default: 0)
  retryDelay?: number; // Milliseconds between retries (default: 1000)
}

/**
 * Timeout handler for managing long-running operations
 *
 * Features:
 * - Cancel operations that exceed timeout
 * - Track operation progress and remaining time
 * - Retry logic with configurable strategies
 * - Graceful cleanup of timed-out operations
 *
 * Example usage:
 * ```
 * const handler = new TimeoutHandler();
 *
 * const result = await handler.executeWithTimeout(
 *   () => apiCall(),
 *   { timeout: 5000, operation: 'api-call' }
 * );
 * ```
 */
export class TimeoutHandler {
  private activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private operationMetrics: Map<
    string,
    {
      startTime: number;
      timeout: number;
      timeoutCount: number;
      lastError: Error | null;
    }
  > = new Map();

  /**
   * Execute a promise with timeout
   */
  async executeWithTimeout<T>(
    fn: () => Promise<T>,
    options: ExecuteOptions
  ): Promise<T> {
    const operationId = options.operation || `op-${Date.now()}`;
    let lastError: Error | null = null;
    let attempt = 0;
    const maxAttempts = (options.retries || 0) + 1;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        return await this.executeOnce<T>(fn, options, operationId, attempt);
      } catch (error) {
        lastError = error as Error;

        // Record timeout occurrence and check if we should retry
        const isTimeout = (error as Error).message.includes('timed out');
        if (isTimeout && attempt < maxAttempts) {
          Logger.warn('Timeout occurred, retrying', {
            operation: operationId,
            attempt,
            maxAttempts,
            timeout: options.timeout,
          });

          // Wait before retry
          const delay = options.retryDelay || 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // If not a timeout or no more retries, throw the error
        throw error;
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Execute once with timeout
   */
  private async executeOnce<T>(
    fn: () => Promise<T>,
    options: ExecuteOptions,
    operationId: string,
    attemptNumber: number = 1
  ): Promise<T> {
    const startTime = Date.now();

    // Initialize operation metrics if not exists
    if (attemptNumber === 1) {
      this.operationMetrics.set(operationId, {
        startTime,
        timeout: options.timeout,
        timeoutCount: 0,
        lastError: null,
      });
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      // Set up timeout
      const timeoutId = setTimeout(async () => {
        if (settled) return;
        settled = true;

        // Update metrics
        const metrics = this.operationMetrics.get(operationId);
        if (metrics) {
          metrics.timeoutCount++;
          metrics.lastError = new Error('Operation timed out');
        }

        // Clean up
        this.activeTimeouts.delete(operationId);

        // Call timeout callback if provided
        if (options.onTimeout) {
          try {
            await options.onTimeout();
          } catch (error) {
            Logger.warn('Error in timeout callback', {
              operation: operationId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const error = new Error(
          `Operation ${operationId} timed out after ${options.timeout}ms`
        );
        Logger.warn('Operation timeout', {
          operation: operationId,
          timeout: options.timeout,
          elapsed: Date.now() - startTime,
        });

        reject(error);
      }, options.timeout);

      this.activeTimeouts.set(operationId, timeoutId);

      // Execute function
      fn()
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            this.activeTimeouts.delete(operationId);

            // Clean up metrics after successful completion
            this.operationMetrics.delete(operationId);

            Logger.debug('Operation completed within timeout', {
              operation: operationId,
              elapsed: Date.now() - startTime,
              timeout: options.timeout,
            });

            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            this.activeTimeouts.delete(operationId);

            // Update error metrics
            const metrics = this.operationMetrics.get(operationId);
            if (metrics) {
              metrics.lastError =
                error instanceof Error ? error : new Error(String(error));
            }

            reject(error);
          }
        });
    });
  }

  /**
   * Execute synchronous function with timeout
   */
  executeSync<T>(
    fn: () => T,
    options: Omit<ExecuteOptions, 'retries' | 'retryDelay' | 'onTimeout'>
  ): T {
    const operationId = options.operation || `sync-op-${Date.now()}`;
    const startTime = Date.now();

    let finished = false;
    let result: T;

    // Note: True synchronous timeout is not possible in JavaScript
    // This implementation measures elapsed time and warns if exceeded
    try {
      result = fn();
      finished = true;
      return result;
    } finally {
      const elapsed = Date.now() - startTime;

      if (elapsed > options.timeout) {
        Logger.warn('Synchronous operation exceeded timeout', {
          operation: operationId,
          timeout: options.timeout,
          elapsed,
        });
      }

      if (!finished) {
        Logger.warn('Synchronous operation did not complete', {
          operation: operationId,
        });
      }
    }
  }

  /**
   * Cancel a specific operation
   */
  cancel(operationId: string): boolean {
    const timeoutId = this.activeTimeouts.get(operationId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(operationId);
      this.operationMetrics.delete(operationId);

      Logger.debug('Operation cancelled', { operation: operationId });
      return true;
    }
    return false;
  }

  /**
   * Cancel all active operations
   */
  cancelAll(): number {
    let count = 0;

    for (const [operationId, timeoutId] of this.activeTimeouts) {
      clearTimeout(timeoutId);
      this.operationMetrics.delete(operationId);
      count++;
    }

    this.activeTimeouts.clear();

    if (count > 0) {
      Logger.info('Cancelled all operations', { count });
    }

    return count;
  }

  /**
   * Get remaining time for an operation
   */
  getRemainingTime(operationId: string): number | null {
    const metrics = this.operationMetrics.get(operationId);
    if (!metrics) return null;

    const elapsed = Date.now() - metrics.startTime;
    const remaining = metrics.timeout - elapsed;

    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get operation metrics
   */
  getMetrics(operationId: string): {
    isActive: boolean;
    timeout: number;
    elapsed: number;
    remaining: number;
    timeoutCount: number;
    lastError: Error | null;
  } | null {
    const metrics = this.operationMetrics.get(operationId);
    if (!metrics) return null;

    const elapsed = Date.now() - metrics.startTime;
    const remaining = Math.max(0, metrics.timeout - elapsed);

    return {
      isActive: this.activeTimeouts.has(operationId),
      timeout: metrics.timeout,
      elapsed,
      remaining,
      timeoutCount: metrics.timeoutCount,
      lastError: metrics.lastError,
    };
  }

  /**
   * Get all active operations
   */
  getActiveOperations(): string[] {
    return Array.from(this.activeTimeouts.keys());
  }

  /**
   * Get count of active operations
   */
  getActiveCount(): number {
    return this.activeTimeouts.size;
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.cancelAll();
    this.operationMetrics.clear();
    Logger.debug('TimeoutHandler cleared');
  }
}

/**
 * Helper function for convenient timeout execution
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeout: number,
  operation?: string
): Promise<T> {
  const handler = new TimeoutHandler();
  return handler.executeWithTimeout(fn, { timeout, operation });
}

/**
 * Global singleton instance
 */
export const globalTimeoutHandler = new TimeoutHandler();
