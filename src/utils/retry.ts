/**
 * Retry utility with exponential backoff and jitter
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number; // 0-1, adds randomness to delay
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 60000, // 60 seconds max
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Calculate delay with exponential backoff and jitter
 * Formula: min(baseDelay * 2^attempt * (1 + jitter), maxDelay)
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff: 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Add jitter: multiply by random value between (1 - jitterFactor) and (1 + jitterFactor)
  const jitterMultiplier = 1 + (Math.random() - 0.5) * 2 * config.jitterFactor;
  const delayWithJitter = exponentialDelay * jitterMultiplier;

  // Cap at max delay
  return Math.min(delayWithJitter, config.maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, delay: number, error: any) => void
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt, throw the error
      if (attempt === config.maxRetries) {
        break;
      }

      // Calculate delay and sleep
      const delay = calculateBackoffDelay(attempt, config);

      // Call optional callback for logging/monitoring
      if (onRetry) {
        onRetry(attempt + 1, delay, error);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable (rate limit or temporary network error)
 */
export function isRetryableError(error: any): boolean {
  // Check for 429 (rate limit)
  if (error.statusCode === 429) {
    return true;
  }

  // Check for network errors
  const code = error.code || error.originalError?.code;
  const retryableNetworkErrors = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ];
  if (retryableNetworkErrors.includes(code)) {
    return true;
  }

  // Check for server errors (5xx)
  if (error.statusCode && error.statusCode >= 500 && error.statusCode < 600) {
    return true;
  }

  return false;
}
