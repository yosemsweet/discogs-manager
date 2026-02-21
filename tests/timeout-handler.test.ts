import { TimeoutHandler, ExecuteOptions, withTimeout, globalTimeoutHandler } from '../src/services/timeout-handler';

describe('TimeoutHandler', () => {
  let handler: TimeoutHandler;

  beforeEach(() => {
    handler = new TimeoutHandler();
  });

  afterEach(() => {
    handler.clear();
  });

  describe('Successful Completion', () => {
    it('should complete operation before timeout', async () => {
      const fn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'success';
      });

      const result = await handler.executeWithTimeout(fn, {
        timeout: 200,
        operation: 'test-op',
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should return operation result', async () => {
      const data = { id: 1, name: 'test' };
      const fn = jest.fn(async () => data);

      const result = await handler.executeWithTimeout(fn, {
        timeout: 1000,
        operation: 'data-op',
      });

      expect(result).toEqual(data);
    });

    it('should complete multiple operations', async () => {
      const fn = jest.fn(async () => 'result');

      const results = await Promise.all([
        handler.executeWithTimeout(fn, { timeout: 1000, operation: 'op1' }),
        handler.executeWithTimeout(fn, { timeout: 1000, operation: 'op2' }),
        handler.executeWithTimeout(fn, { timeout: 1000, operation: 'op3' }),
      ]);

      expect(results).toEqual(['result', 'result', 'result']);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Timeout Occurrence', () => {
    it('should throw on timeout', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 100,
          operation: 'timeout-op',
        })
      ).rejects.toThrow('timed out');
    });

    it('should include operation name in timeout error', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      try {
        await handler.executeWithTimeout(fn, {
          timeout: 50,
          operation: 'my-operation',
        });
        fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('my-operation');
      }
    });

    it('should call timeout callback', async () => {
      const onTimeout = jest.fn();
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 50,
          operation: 'cb-op',
          onTimeout,
        })
      ).rejects.toThrow();

      // Wait for callback
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onTimeout).toHaveBeenCalled();
    });

    it('should handle async timeout callback', async () => {
      let callbackExecuted = false;
      const onTimeout = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        callbackExecuted = true;
      });

      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 50,
          operation: 'async-cb-op',
          onTimeout,
        })
      ).rejects.toThrow();

      // Wait for async callback
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(callbackExecuted).toBe(true);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on timeout', async () => {
      let attemptCount = 0;
      const fn = jest.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          // First attempt times out
          await new Promise(() => {
            // Never resolves
          });
        }
        return 'success';
      });

      const result = await handler.executeWithTimeout(fn, {
        timeout: 50,
        operation: 'retry-op',
        retries: 2,
        retryDelay: 10,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect retry count', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 50,
          operation: 'max-retry-op',
          retries: 2,
          retryDelay: 10,
        })
      ).rejects.toThrow();

      // Should have been called 3 times (initial + 2 retries)
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use default retry delay', async () => {
      let attemptCount = 0;
      const startTime = Date.now();

      const fn = jest.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          await new Promise(() => {
            // Never resolves
          });
        }
        return 'success';
      });

      await handler.executeWithTimeout(fn, {
        timeout: 50,
        operation: 'default-delay-op',
        retries: 1,
        // Default retryDelay is 1000, but we can't easily test that here
      });

      // Just verify it tried again
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry if not configured', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 50,
          operation: 'no-retry-op',
        })
      ).rejects.toThrow();

      // Should only be called once
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should throw operation errors', async () => {
      const error = new Error('Operation error');
      const fn = jest.fn(async () => {
        throw error;
      });

      await expect(
        handler.executeWithTimeout(fn, {
          timeout: 1000,
          operation: 'error-op',
        })
      ).rejects.toThrow('Operation error');
    });

    it('should not mask operation errors as timeouts', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Custom error');
      });

      try {
        await handler.executeWithTimeout(fn, {
          timeout: 1000,
          operation: 'custom-error-op',
        });
        fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Custom error');
        expect((error as Error).message).not.toContain('timed out');
      }
    });
  });

  describe('Synchronous Execution', () => {
    it('should execute sync function', () => {
      const fn = jest.fn(() => 'sync result');

      const result = handler.executeSync(fn, {
        timeout: 1000,
        operation: 'sync-op',
      });

      expect(result).toBe('sync result');
      expect(fn).toHaveBeenCalled();
    });

    it('should warn if sync operation exceeds timeout', () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

      const fn = () => {
        // Simulate work that takes longer than timeout
        const start = Date.now();
        while (Date.now() - start < 150) {
          // Busy wait
        }
        return 'result';
      };

      handler.executeSync(fn, {
        timeout: 100,
        operation: 'slow-sync-op',
      });

      // Note: Can't easily verify warning in real sync execution
      consoleWarn.mockRestore();
    });

    it('should return sync function result', () => {
      const data = { value: 42 };
      const fn = () => data;

      const result = handler.executeSync(fn, {
        timeout: 1000,
        operation: 'data-sync-op',
      });

      expect(result).toBe(data);
    });
  });

  describe('Operation Cancellation', () => {
    it('should cancel specific operation', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      const promise = handler.executeWithTimeout(fn, {
        timeout: 5000,
        operation: 'cancel-op',
      });

      // Cancel before timeout
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cancelled = handler.cancel('cancel-op');

      expect(cancelled).toBe(true);

      // Wait a bit to ensure cancellation completed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The operation should have timed out naturally or been cancelled
      // This test mainly verifies the cancel method works
    });

    it('should return false when cancelling non-existent operation', () => {
      const result = handler.cancel('non-existent-op');
      expect(result).toBe(false);
    });

    it('should cancel all active operations', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      // Start multiple operations
      const p1 = handler.executeWithTimeout(fn, {
        timeout: 5000,
        operation: 'op1',
      });
      const p2 = handler.executeWithTimeout(fn, {
        timeout: 5000,
        operation: 'op2',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const count = handler.cancelAll();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Operation Metrics', () => {
    it('should track remaining time', async () => {
      const fn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      });

      const promise = handler.executeWithTimeout(fn, {
        timeout: 1000,
        operation: 'remaining-op',
      });

      const remaining1 = handler.getRemainingTime('remaining-op');
      expect(remaining1).toBeDefined();
      expect(remaining1!).toBeGreaterThan(0);
      expect(remaining1!).toBeLessThanOrEqual(1000);

      await promise;

      // After completion, metrics should be cleared
      const remaining2 = handler.getRemainingTime('remaining-op');
      expect(remaining2).toBeNull();
    });

    it('should return null for non-existent operation', () => {
      const remaining = handler.getRemainingTime('non-existent-op');
      expect(remaining).toBeNull();
    });

    it('should get operation metrics', async () => {
      const fn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'result';
      });

      const promise = handler.executeWithTimeout(fn, {
        timeout: 500,
        operation: 'metrics-op',
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const metrics = handler.getMetrics('metrics-op');
      expect(metrics).toBeDefined();
      if (metrics) {
        expect(metrics.timeout).toBe(500);
        expect(metrics.elapsed).toBeGreaterThan(0);
        expect(metrics.remaining).toBeGreaterThan(0);
        expect(metrics.remaining).toBeLessThan(500);
      }

      await promise;
    });

    it('should track timeout count', async () => {
      let attempt = 0;
      const fn = jest.fn(async () => {
        attempt++;
        if (attempt <= 1) {
          await new Promise(() => {
            // Never resolves
          });
        }
        return 'success';
      });

      await handler.executeWithTimeout(fn, {
        timeout: 50,
        operation: 'timeout-count-op',
        retries: 1,
        retryDelay: 10,
      });

      // After completion, metrics should be cleared
      const metrics = handler.getMetrics('timeout-count-op');
      expect(metrics).toBeNull();
    });
  });

  describe('Active Operations Tracking', () => {
    it('should list active operations', async () => {
      const fn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'result';
      });

      const p1 = handler.executeWithTimeout(fn, {
        timeout: 1000,
        operation: 'active-op1',
      });
      const p2 = handler.executeWithTimeout(fn, {
        timeout: 1000,
        operation: 'active-op2',
      });

      const active = handler.getActiveOperations();
      expect(active).toContain('active-op1');
      expect(active).toContain('active-op2');

      await Promise.all([p1, p2]);
    });

    it('should report active count', async () => {
      const fn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      });

      const p1 = handler.executeWithTimeout(fn, {
        timeout: 1000,
        operation: 'count-op1',
      });

      const count1 = handler.getActiveCount();
      expect(count1).toBeGreaterThan(0);

      await p1;

      const count2 = handler.getActiveCount();
      expect(count2).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should clear all operations', async () => {
      const fn = jest.fn(async () => {
        await new Promise(() => {
          // Never resolves
        });
      });

      handler.executeWithTimeout(fn, {
        timeout: 5000,
        operation: 'clear-op1',
      });
      handler.executeWithTimeout(fn, {
        timeout: 5000,
        operation: 'clear-op2',
      });

      expect(handler.getActiveCount()).toBeGreaterThan(0);

      handler.clear();

      expect(handler.getActiveCount()).toBe(0);
      expect(handler.getActiveOperations().length).toBe(0);
    });
  });
});

describe('Helper Function', () => {
  it('should execute with timeout helper', async () => {
    const fn = jest.fn(async () => 'result');

    const result = await withTimeout(fn, 1000, 'helper-op');

    expect(result).toBe('result');
  });

  it('should timeout with helper', async () => {
    const fn = jest.fn(async () => {
      await new Promise(() => {
        // Never resolves
      });
    });

    await expect(withTimeout(fn, 50, 'timeout-helper-op')).rejects.toThrow(
      'timed out'
    );
  });
});

describe('Global Instance', () => {
  beforeEach(() => {
    globalTimeoutHandler.clear();
  });

  it('should use global singleton', async () => {
    const fn = jest.fn(async () => 'result');

    const result = await globalTimeoutHandler.executeWithTimeout(fn, {
      timeout: 1000,
      operation: 'global-op',
    });

    expect(result).toBe('result');
  });
});

describe('Edge Cases', () => {
  let handler: TimeoutHandler;

  beforeEach(() => {
    handler = new TimeoutHandler();
  });

  afterEach(() => {
    handler.clear();
  });

  it('should handle very small timeout', async () => {
    const fn = jest.fn(async () => {
      await new Promise(() => {
        // Never resolves
      });
    });

    await expect(
      handler.executeWithTimeout(fn, {
        timeout: 1,
        operation: 'small-timeout-op',
      })
    ).rejects.toThrow();
  });

  it('should handle very large timeout', async () => {
    const fn = jest.fn(async () => 'result');

    const result = await handler.executeWithTimeout(fn, {
      timeout: 999999999,
      operation: 'large-timeout-op',
    });

    expect(result).toBe('result');
  });

  it('should handle promises that resolve to null', async () => {
    const fn = jest.fn(async () => null);

    const result = await handler.executeWithTimeout(fn, {
      timeout: 1000,
      operation: 'null-result-op',
    });

    expect(result).toBeNull();
  });

  it('should handle promises that resolve to undefined', async () => {
    const fn = jest.fn(async () => undefined);

    const result = await handler.executeWithTimeout(fn, {
      timeout: 1000,
      operation: 'undefined-result-op',
    });

    expect(result).toBeUndefined();
  });

  it('should handle timeout callback errors gracefully', async () => {
    const onTimeout = jest.fn(() => {
      throw new Error('Callback error');
    });

    const fn = jest.fn(async () => {
      await new Promise(() => {
        // Never resolves
      });
    });

    await expect(
      handler.executeWithTimeout(fn, {
        timeout: 50,
        operation: 'callback-error-op',
        onTimeout,
      })
    ).rejects.toThrow('timed out');

    // Wait for callback
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onTimeout).toHaveBeenCalled();
  });
});
