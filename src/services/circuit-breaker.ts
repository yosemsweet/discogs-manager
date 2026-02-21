import { Logger } from '../utils/logger';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures to trip the circuit
  successThreshold: number; // Number of successes needed to close circuit from half-open
  timeout: number; // Milliseconds to wait before attempting to half-open
  windowSize: number; // Milliseconds for tracking failures
  name: string; // Identifier for logging
}

/**
 * Tracks call statistics for the circuit breaker
 */
interface CallStats {
  timestamp: number;
  success: boolean;
  error?: string;
}

/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by:
 * 1. CLOSED: Normal operation, tracking failures
 * 2. OPEN: Rejecting calls when failure threshold exceeded
 * 3. HALF_OPEN: Testing if service recovered by allowing limited calls
 *
 * Example usage:
 * ```
 * const breaker = new CircuitBreaker({
 *   name: 'discogs-api',
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   timeout: 30000,
 *   windowSize: 60000
 * });
 *
 * try {
 *   const result = await breaker.execute(() => apiCall());
 * } catch (error) {
 *   // Handle circuit open or call failure
 * }
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private callHistory: CallStats[] = [];
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    const defaults = {
      successThreshold: 2,
      windowSize: 60000,
    };
    this.config = { ...defaults, ...config };

    Logger.info('Circuit breaker initialized', {
      name: this.config.name,
      failureThreshold: this.config.failureThreshold,
      timeout: this.config.timeout,
    });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    this.checkStateTransition();

    // Reject if circuit is OPEN
    if (this.state === CircuitState.OPEN) {
      const error = new Error(
        `Circuit breaker ${this.config.name} is OPEN. Service unavailable.`
      );
      Logger.warn('Circuit breaker rejecting call', {
        name: this.config.name,
        state: this.state,
      });
      throw error;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Execute a function synchronously
   */
  executeSync<T>(fn: () => T): T {
    // Check if circuit should transition from OPEN to HALF_OPEN
    this.checkStateTransition();

    // Reject if circuit is OPEN
    if (this.state === CircuitState.OPEN) {
      const error = new Error(
        `Circuit breaker ${this.config.name} is OPEN. Service unavailable.`
      );
      Logger.warn('Circuit breaker rejecting call', {
        name: this.config.name,
        state: this.state,
      });
      throw error;
    }

    try {
      const result = fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(): void {
    const now = Date.now();
    this.callHistory.push({ timestamp: now, success: true });

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      Logger.debug('Circuit breaker half-open success', {
        name: this.config.name,
        successCount: this.successCount,
      });

      // Close circuit if enough successes
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      if (this.failureCount > 0) {
        this.failureCount = 0;
        Logger.debug('Circuit breaker reset failure count', {
          name: this.config.name,
        });
      }
    }

    // Clean up old call history
    this.cleanupCallHistory();
  }

  /**
   * Record a failed call
   */
  private recordFailure(error: Error | unknown): void {
    const now = Date.now();
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    this.callHistory.push({
      timestamp: now,
      success: false,
      error: errorMessage,
    });

    this.lastFailureTime = now;

    if (this.state === CircuitState.HALF_OPEN) {
      // Open circuit if failure during half-open state
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;
      Logger.debug('Circuit breaker recorded failure', {
        name: this.config.name,
        failureCount: this.failureCount,
        threshold: this.config.failureThreshold,
      });

      // Open circuit if failure threshold exceeded
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }

    // Clean up old call history
    this.cleanupCallHistory();
  }

  /**
   * Check if circuit should transition from OPEN to HALF_OPEN
   */
  private checkStateTransition(): void {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
  }

  /**
   * Transition circuit to new state
   */
  private transitionTo(newState: CircuitState): void {
    if (newState === this.state) return;

    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }

    Logger.info('Circuit breaker state transition', {
      name: this.config.name,
      from: oldState,
      to: newState,
    });
  }

  /**
   * Clean up call history older than window
   */
  private cleanupCallHistory(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowSize;

    // Keep calls within the window
    this.callHistory = this.callHistory.filter(
      (call) => call.timestamp >= windowStart
    );
  }

  /**
   * Get circuit breaker status
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Get detailed metrics
   */
  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    totalCalls: number;
    successRate: number;
    lastFailureTime: number | null;
  } {
    this.checkStateTransition();

    const successfulCalls = this.callHistory.filter((c) => c.success).length;
    const totalCalls = this.callHistory.length;
    const successRate = totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalCalls,
      successRate: Math.round(successRate * 10) / 10,
      lastFailureTime: this.lastFailureTime || null,
    };
  }

  /**
   * Reset circuit breaker (for testing or manual recovery)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.callHistory = [];

    Logger.info('Circuit breaker reset', { name: this.config.name });
  }

  /**
   * Manually open or close circuit
   */
  setState(newState: CircuitState): void {
    this.transitionTo(newState);
  }
}

/**
 * Global circuit breaker manager
 */
export class CircuitBreakerManager {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(name: string, config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const defaultConfig: CircuitBreakerConfig = {
      name,
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000, // 30 seconds
      windowSize: 60000, // 60 seconds
      ...config,
    };

    const breaker = new CircuitBreaker(defaultConfig);
    this.breakers.set(name, breaker);
    return breaker;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get status of all breakers
   */
  getAllMetrics(): Record<string, ReturnType<CircuitBreaker['getMetrics']>> {
    const metrics: Record<string, ReturnType<CircuitBreaker['getMetrics']>> = {};

    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }

    return metrics;
  }

  /**
   * Reset a specific breaker
   */
  reset(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  /**
   * Reset all breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    Logger.info('All circuit breakers reset');
  }

  /**
   * Clear all breakers
   */
  clear(): void {
    this.breakers.clear();
    Logger.info('All circuit breakers cleared');
  }
}

// Export singleton instance
export const circuitBreakerManager = new CircuitBreakerManager();
