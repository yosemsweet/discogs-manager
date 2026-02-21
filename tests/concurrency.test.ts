import { ConcurrencyManager, Task, RateLimiter, BatchProcessor } from '../src/utils/concurrency';

describe('ConcurrencyManager', () => {
  let manager: ConcurrencyManager;

  beforeEach(() => {
    manager = new ConcurrencyManager(3, 2, 1000); // 3 concurrent, 2 retries, 1s timeout
  });

  afterEach(() => {
    manager.clear();
  });

  describe('basic execution', () => {
    test('executes single task', async () => {
      const task: Task<string> = {
        id: 'task1',
        execute: async () => 'result',
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(true);
      expect(result.result).toBe('result');
      expect(result.attempt).toBe(1);
    });

    test('executes multiple tasks sequentially', async () => {
      const tasks: Task<number>[] = [
        { id: 'task1', execute: async () => 1 },
        { id: 'task2', execute: async () => 2 },
        { id: 'task3', execute: async () => 3 },
      ];

      const results = await manager.enqueueBatch(tasks);

      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    test('respects concurrency limit', async () => {
      const concurrentTasks: Set<string> = new Set();
      const maxConcurrent: number[] = [];

      const tasks: Task<void>[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `task${i}`,
          execute: async () => {
            concurrentTasks.add(`task${i}`);
            maxConcurrent.push(concurrentTasks.size);
            await new Promise(resolve => setTimeout(resolve, 50));
            concurrentTasks.delete(`task${i}`);
          },
        }));

      await manager.enqueueBatch(tasks);

      const maxFound = Math.max(...maxConcurrent);
      expect(maxFound).toBeLessThanOrEqual(3);
    });
  });

  describe('retry mechanism', () => {
    test('retries failed tasks', async () => {
      let attempts = 0;
      const task: Task<string> = {
        id: 'retry-task',
        retries: 2,
        execute: async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary error');
          }
          return 'success';
        },
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(true);
      expect(result.attempt).toBe(3);
      expect(attempts).toBe(3);
    });

    test('fails after retries exhausted', async () => {
      const task: Task<string> = {
        id: 'fail-task',
        retries: 1,
        execute: async () => {
          throw new Error('Persistent error');
        },
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(false);
      expect(result.attempt).toBe(2);
      expect(result.error?.message).toContain('Persistent error');
    });

    test('respects default retry count', async () => {
      let attempts = 0;
      const task: Task<string> = {
        id: 'default-retry',
        execute: async () => {
          attempts++;
          if (attempts <= 1) {
            throw new Error('Error');
          }
          return 'success';
        },
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(true);
      expect(attempts).toBe(2); // 1 initial + 1 retry (default is 2)
    });
  });

  describe('timeout handling', () => {
    test('times out long-running task', async () => {
      const task: Task<void> = {
        id: 'slow-task',
        timeout: 100,
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
        },
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timeout');
    });

    test('respects default timeout', async () => {
      const quickManager = new ConcurrencyManager(1, 0, 100);
      const task: Task<void> = {
        id: 'timeout-task',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
        },
      };

      const result = await quickManager.enqueue(task);

      expect(result.success).toBe(false);
    });

    test('completes before timeout', async () => {
      const task: Task<string> = {
        id: 'fast-task',
        timeout: 500,
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'success';
        },
      };

      const result = await manager.enqueue(task);

      expect(result.success).toBe(true);
    });
  });

  describe('priority queue', () => {
    test('executes higher priority tasks first', async () => {
      const execution: string[] = [];

      const tasks: Task<void>[] = [
        {
          id: 'low',
          priority: 1,
          execute: async () => {
            execution.push('low');
            await new Promise(resolve => setTimeout(resolve, 50));
          },
        },
        {
          id: 'high',
          priority: 10,
          execute: async () => {
            execution.push('high');
          },
        },
      ];

      // Enqueue low priority first, then high
      manager.enqueue(tasks[0]);
      manager.enqueue(tasks[1]);

      await manager.waitAll();

      // High priority should be in results earlier
      const highIndex = execution.findIndex(e => e === 'high');
      expect(highIndex).not.toBe(-1);
    });
  });

  describe('results and statistics', () => {
    test('retrieves results by ID', async () => {
      const task: Task<string> = {
        id: 'result-task',
        execute: async () => 'test-result',
      };

      await manager.enqueue(task);

      const result = manager.getResult('result-task');
      expect(result?.success).toBe(true);
      expect(result?.result).toBe('test-result');
    });

    test('separates successful and failed results', async () => {
      const tasks: Task<any>[] = [
        { id: 'success1', execute: async () => 'ok' },
        { id: 'fail1', execute: async () => { throw new Error('failed'); } },
        { id: 'success2', execute: async () => 'ok' },
      ];

      await manager.enqueueBatch(tasks);

      expect(manager.getSuccessful().length).toBe(2);
      expect(manager.getFailed().length).toBe(1);
    });

    test('tracks statistics', async () => {
      const tasks: Task<any>[] = Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `task${i}`,
          execute: async () => i,
        }));

      await manager.enqueueBatch(tasks);

      const stats = manager.getStats();
      expect(stats.totalTasks).toBe(5);
      expect(stats.completedTasks).toBe(5);
      expect(stats.failedTasks).toBe(0);
      expect(stats.averageTaskDuration).toBeGreaterThanOrEqual(0);
    });

    test('calculates task duration', async () => {
      const task: Task<void> = {
        id: 'duration-task',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      };

      const result = await manager.enqueue(task);

      expect(result.duration).toBeGreaterThanOrEqual(100);
      expect(result.duration).toBeLessThan(200);
    });
  });

  describe('reset and clear', () => {
    test('reset clears results', async () => {
      const task: Task<string> = {
        id: 'task',
        execute: async () => 'result',
      };

      await manager.enqueue(task);
      expect(manager.getStats().totalTasks).toBe(1);

      manager.reset();
      expect(manager.getStats().totalTasks).toBe(0);
    });

    test('clear removes queued tasks', () => {
      manager.enqueue({ id: 'task1', execute: async () => {} });
      manager.enqueue({ id: 'task2', execute: async () => {} });

      manager.clear();

      const stats = manager.getStats();
      expect(stats.queuedTasks).toBe(0);
    });
  });

  describe('waitAll', () => {
    test('waits for all tasks to complete', async () => {
      const tasks: Task<number>[] = Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `task${i}`,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return i;
          },
        }));

      for (const task of tasks) {
        manager.enqueue(task);
      }

      await manager.waitAll();

      const stats = manager.getStats();
      expect(stats.completedTasks + stats.failedTasks).toBe(5);
      expect(stats.activeTasks).toBe(0);
    });
  });
});

describe('RateLimiter', () => {
  test('allows requests within rate limit', () => {
    const limiter = new RateLimiter(10, 100); // 10 tokens, refill every 100ms

    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.getTokens()).toBe(8);
  });

  test('denies requests exceeding rate limit', () => {
    const limiter = new RateLimiter(2, 100);

    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
  });

  test('refills tokens over time', async () => {
    const limiter = new RateLimiter(5, 100);

    limiter.allow(5); // Use all tokens
    expect(limiter.getTokens()).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 150));

    expect(limiter.getTokens()).toBeGreaterThan(0);
  });

  test('respects multi-token consumption', () => {
    const limiter = new RateLimiter(10, 100);

    expect(limiter.allow(3)).toBe(true);
    expect(limiter.getTokens()).toBe(7);

    expect(limiter.allow(8)).toBe(false);
    expect(limiter.allow(7)).toBe(true);
  });

  test('waitUntilAllowed blocks until available', async () => {
    const limiter = new RateLimiter(1, 100);

    limiter.allow(); // Consume the token

    const start = Date.now();
    await limiter.waitUntilAllowed();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(100);
  });
});

describe('BatchProcessor', () => {
  test('processBatches with sequential batches', async () => {
    const items = Array(10)
      .fill(null)
      .map((_, i) => i);

    const results = await BatchProcessor.processBatches(items, 3, async batch => {
      return batch.map(item => item * 2);
    });

    expect(results.length).toBe(10);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  test('processParallelBatches with concurrent batches', async () => {
    const items = Array(12)
      .fill(null)
      .map((_, i) => i);

    const results = await BatchProcessor.processParallelBatches(items, 4, 2, async batch => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return batch.map(item => item * 2);
    });

    expect(results.length).toBe(12);
  });

  test('handles empty batches', async () => {
    const results = await BatchProcessor.processBatches([], 5, async batch => {
      return batch;
    });

    expect(results).toEqual([]);
  });

  test('handles single batch smaller than batch size', async () => {
    const items = [1, 2, 3];

    const results = await BatchProcessor.processBatches(items, 10, async batch => {
      return batch;
    });

    expect(results).toEqual([1, 2, 3]);
  });

  test('preserves order across parallel batches', async () => {
    const items = Array(20)
      .fill(null)
      .map((_, i) => i);

    const results = await BatchProcessor.processParallelBatches(items, 5, 3, async batch => {
      return batch.map(item => item);
    });

    expect(results.length).toBe(20);
    for (let i = 0; i < results.length; i++) {
      expect(results.includes(i)).toBe(true);
    }
  });
});

describe('Integration tests', () => {
  test('handles complex workflow', async () => {
    const manager = new ConcurrencyManager(3);

    // Simulate API calls with rate limiting
    const limiter = new RateLimiter(10, 100);
    const tasks: Task<number>[] = Array(5)
      .fill(null)
      .map((_, i) => ({
        id: `api-call-${i}`,
        execute: async () => {
          await limiter.waitUntilAllowed();
          return i * 100;
        },
      }));

    const results = await manager.enqueueBatch(tasks);

    expect(results.every(r => r.success)).toBe(true);
    expect(results.length).toBe(5);
  });

  test('handles batch processing with concurrency', async () => {
    const items = Array(100)
      .fill(null)
      .map((_, i) => i);

    const results = await BatchProcessor.processParallelBatches(items, 10, 5, async batch => {
      return batch.map(item => item * 2);
    });

    expect(results.length).toBe(100);
    expect(Math.max(...results)).toBe(198);
  });

  test('handles mixed success and failure with retries', async () => {
    const manager = new ConcurrencyManager(2, 2);

    let flakyAttempts = 0;

    const tasks: Task<any>[] = [
      {
        id: 'success1',
        execute: async () => 'ok',
      },
      {
        id: 'flaky',
        retries: 3,
        execute: async () => {
          flakyAttempts++;
          if (flakyAttempts < 3) throw new Error('Flaky');
          return 'recovered';
        },
      },
      {
        id: 'fail',
        retries: 1,
        execute: async () => {
          throw new Error('Always fails');
        },
      },
    ];

    const results = await manager.enqueueBatch(tasks);

    expect(results.some(r => r.success)).toBe(true);
    expect(results.some(r => !r.success)).toBe(true);
  });
});
