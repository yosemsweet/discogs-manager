import { Logger } from './logger';

/**
 * Task item for queue-based concurrent execution
 */
export interface Task<T> {
    id: string;
    execute: () => Promise<T>;
    priority?: number; // Higher number = higher priority
    retries?: number;
    timeout?: number; // milliseconds
}

/**
 * Task result with metadata
 */
export interface TaskResult<T> {
    id: string;
    success: boolean;
    result?: T;
    error?: Error;
    duration: number;
    attempt: number;
}

/**
 * Concurrency manager statistics
 */
export interface ConcurrencyStats {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    activeTasks: number;
    queuedTasks: number;
    totalDuration: number;
    averageTaskDuration: number;
}

/**
 * Manages concurrent task execution with:
 * - Configurable concurrency limits
 * - Priority-based queue
 * - Automatic retry with backoff
 * - Timeout handling
 * - Comprehensive statistics
 *
 * Ideal for: Parallel API calls, batch operations, rate-limited services
 */
export class ConcurrencyManager {
    private queue: Task<any>[] = [];
    private activeTasks = new Map<string, Promise<any>>();
    private results: TaskResult<any>[] = [];
    private stats = {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalDuration: 0,
    };

    private readonly maxConcurrent: number;
    private readonly defaultRetries: number;
    private readonly defaultTimeout: number;

    /**
     * Initialize concurrency manager
     * @param maxConcurrent Maximum concurrent tasks (default: 5)
     * @param defaultRetries Default retry attempts (default: 2)
     * @param defaultTimeout Default task timeout in ms (default: 30000)
     */
    constructor(maxConcurrent: number = 5, defaultRetries: number = 2, defaultTimeout: number = 30000) {
        this.maxConcurrent = maxConcurrent;
        this.defaultRetries = defaultRetries;
        this.defaultTimeout = defaultTimeout;

        Logger.debug(`ConcurrencyManager initialized (max: ${maxConcurrent}, retries: ${defaultRetries})`);
    }

    /**
     * Add a task to the queue
     * @param task Task to execute
     * @returns Promise that resolves when task completes
     */
    async enqueue<T>(task: Task<T>): Promise<TaskResult<T>> {
        this.queue.push(task);
        this.stats.totalTasks++;

        // Set default retry and timeout
        if (task.retries === undefined) {
            task.retries = this.defaultRetries;
        }
        if (task.timeout === undefined) {
            task.timeout = this.defaultTimeout;
        }

        this.processQueue();

        // Wait for task to complete
        return new Promise(resolve => {
            const checkCompletion = setInterval(() => {
                const result = this.results.find(r => r.id === task.id);
                if (result) {
                    clearInterval(checkCompletion);
                    resolve(result);
                }
            }, 50);
        });
    }

    /**
     * Add multiple tasks at once
     * @param tasks Array of tasks
     * @returns Promise that resolves to array of results when all complete
     */
    async enqueueBatch<T>(tasks: Task<T>[]): Promise<TaskResult<T>[]> {
        const promises = tasks.map(task => this.enqueue(task));
        return Promise.all(promises);
    }

    /**
     * Process queue respecting concurrency limits
     */
    private processQueue(): void {
        while (this.activeTasks.size < this.maxConcurrent && this.queue.length > 0) {
            // Sort by priority (higher first)
            this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

            const task = this.queue.shift();
            if (!task) break;

            const promise = this.executeTask(task);
            this.activeTasks.set(task.id, promise);

            promise.finally(() => {
                this.activeTasks.delete(task.id);
                this.processQueue(); // Process next task
            });
        }
    }

    /**
     * Execute a single task with retry and timeout logic
     */
    private async executeTask<T>(task: Task<T>): Promise<void> {
        const startTime = Date.now();
        let lastError: Error | undefined;
        let attempt = 0;

        while (attempt <= (task.retries || 0)) {
            attempt++;
            try {
                Logger.debug(`Executing task ${task.id} (attempt ${attempt}/${(task.retries || 0) + 1})`);

                const result = await this.executeWithTimeout(task.execute(), task.timeout || this.defaultTimeout);

                const duration = Date.now() - startTime;
                this.stats.completedTasks++;
                this.stats.totalDuration += duration;

                this.results.push({
                    id: task.id,
                    success: true,
                    result,
                    duration,
                    attempt,
                });

                Logger.debug(`Task ${task.id} completed in ${duration}ms`);
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (attempt <= (task.retries || 0)) {
                    // Calculate exponential backoff: 100ms * 2^(attempt-1)
                    const backoff = 100 * Math.pow(2, attempt - 1);
                    Logger.debug(`Task ${task.id} failed, retrying in ${backoff}ms: ${lastError.message}`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                }
            }
        }

        // All retries exhausted
        const duration = Date.now() - startTime;
        this.stats.failedTasks++;
        this.stats.totalDuration += duration;

        this.results.push({
            id: task.id,
            success: false,
            error: lastError,
            duration,
            attempt,
        });

        Logger.debug(`Task ${task.id} failed after ${attempt} attempts: ${lastError?.message}`);
    }

    /**
     * Execute a promise with timeout
     */
    private executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs)
            ),
        ]);
    }

    /**
     * Get all results
     */
    getResults(): TaskResult<any>[] {
        return [...this.results];
    }

    /**
     * Get result by task ID
     */
    getResult(taskId: string): TaskResult<any> | undefined {
        return this.results.find(r => r.id === taskId);
    }

    /**
     * Get successful results
     */
    getSuccessful(): TaskResult<any>[] {
        return this.results.filter(r => r.success);
    }

    /**
     * Get failed results
     */
    getFailed(): TaskResult<any>[] {
        return this.results.filter(r => !r.success);
    }

    /**
     * Get current statistics
     */
    getStats(): ConcurrencyStats {
        return {
            totalTasks: this.stats.totalTasks,
            completedTasks: this.stats.completedTasks,
            failedTasks: this.stats.failedTasks,
            activeTasks: this.activeTasks.size,
            queuedTasks: this.queue.length,
            totalDuration: this.stats.totalDuration,
            averageTaskDuration:
                this.stats.completedTasks > 0 ? this.stats.totalDuration / this.stats.completedTasks : 0,
        };
    }

    /**
     * Wait for all active and queued tasks to complete
     */
    async waitAll(): Promise<void> {
        while (this.activeTasks.size > 0 || this.queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Reset results and statistics
     */
    reset(): void {
        this.results = [];
        this.stats = { totalTasks: 0, completedTasks: 0, failedTasks: 0, totalDuration: 0 };
        Logger.debug('ConcurrencyManager reset');
    }

    /**
     * Clear queue and cancel pending tasks
     */
    clear(): void {
        this.queue = [];
        Logger.debug('ConcurrencyManager queue cleared');
    }
}

/**
 * Rate limiter for API calls with bucket algorithm
 */
export class RateLimiter {
    private tokens: number;
    private lastRefillTime: number = Date.now();

    /**
     * Initialize rate limiter
     * @param capacity Maximum tokens (requests) allowed
     * @param refillRateMs Time in ms for one token refill
     */
    constructor(private capacity: number, private refillRateMs: number) {
        this.tokens = capacity;
    }

    /**
     * Check if request is allowed and consume token if available
     * @param tokensNeeded Tokens to consume (default: 1)
     * @returns true if allowed, false if rate limited
     */
    allow(tokensNeeded: number = 1): boolean {
        this.refillTokens();

        if (this.tokens >= tokensNeeded) {
            this.tokens -= tokensNeeded;
            return true;
        }

        return false;
    }

    /**
     * Wait until request is allowed (blocks until available)
     */
    async waitUntilAllowed(tokensNeeded: number = 1): Promise<void> {
        while (!this.allow(tokensNeeded)) {
            await new Promise(resolve => setTimeout(resolve, this.refillRateMs));
        }
    }

    /**
     * Get current token count
     */
    getTokens(): number {
        this.refillTokens();
        return this.tokens;
    }

    /**
     * Refill tokens based on elapsed time
     */
    private refillTokens(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefillTime;
        const tokensToAdd = Math.floor(elapsed / this.refillRateMs);

        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
            this.lastRefillTime = now;
        }
    }
}

/**
 * Batch processor for chunking large arrays of work
 */
export class BatchProcessor<T, R> {
    /**
     * Process items in batches with a handler function
     * @param items Array of items to process
     * @param batchSize Size of each batch
     * @param handler Function to execute on each batch
     * @returns Array of all results
     */
    static async processBatches<T, R>(
        items: T[],
        batchSize: number,
        handler: (batch: T[]) => Promise<R[]>
    ): Promise<R[]> {
        const results: R[] = [];

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await handler(batch);
            results.push(...batchResults);

            Logger.debug(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);
        }

        return results;
    }

    /**
     * Process items in parallel batches
     * @param items Array of items to process
     * @param batchSize Size of each batch
     * @param concurrency Number of batches to process concurrently
     * @param handler Function to execute on each batch
     * @returns Array of all results
     */
    static async processParallelBatches<T, R>(
        items: T[],
        batchSize: number,
        concurrency: number,
        handler: (batch: T[]) => Promise<R[]>
    ): Promise<R[]> {
        const results: R[] = [];
        const batches: T[][] = [];

        // Create batches
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }

        // Process in parallel with concurrency limit
        const manager = new ConcurrencyManager(concurrency);

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const task: Task<R[]> = {
                id: `batch-${i}`,
                execute: () => handler(batch),
            };

            manager.enqueue(task);
        }

        await manager.waitAll();

        // Collect results in order
        for (let i = 0; i < batches.length; i++) {
            const result = manager.getResult(`batch-${i}`);
            if (result?.success && result.result) {
                results.push(...result.result);
            }
        }

        return results;
    }
}
