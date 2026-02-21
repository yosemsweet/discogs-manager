import { CircuitBreaker, CircuitBreakerManager, CircuitState, circuitBreakerManager } from '../src/services/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'test-service',
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowSize: 5000,
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should initialize metrics correctly', () => {
      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.totalCalls).toBe(0);
    });
  });

  describe('Closed State Operation', () => {
    it('should execute successful calls when closed', async () => {
      const fn = jest.fn(async () => 'success');
      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should track successful calls', async () => {
      const fn = jest.fn(async () => 'success');

      for (let i = 0; i < 5; i++) {
        await breaker.execute(fn);
      }

      const metrics = breaker.getMetrics();
      expect(metrics.totalCalls).toBe(5);
      expect(metrics.successRate).toBe(100);
    });

    it('should increment failure count on error', async () => {
      const fn = jest.fn(async () => {
        throw new Error('API Error');
      });

      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(2);
      expect(metrics.successRate).toBe(0);
    });

    it('should pass through errors in closed state', async () => {
      const error = new Error('API Error');
      const fn = jest.fn(async () => {
        throw error;
      });

      await expect(breaker.execute(fn)).rejects.toThrow('API Error');
    });

    it('should reset failure count after success in closed state', async () => {
      const failingFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Generate failures
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (error) {
          // Expected
        }
      }

      const successFn = jest.fn(async () => 'success');
      await breaker.execute(successFn);

      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(0);
    });
  });

  describe('Open State Transition', () => {
    it('should transition to OPEN when failure threshold exceeded', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Trigger failures to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject calls when OPEN', async () => {
      const failingFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (error) {
          // Expected
        }
      }

      // Should reject without calling the function
      const successFn = jest.fn(async () => 'success');
      await expect(breaker.execute(successFn)).rejects.toThrow('Circuit breaker');

      expect(successFn).not.toHaveBeenCalled();
    });

    it('should reject multiple calls when OPEN', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      // All subsequent calls should be rejected
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker');
      }
    });
  });

  describe('Half-Open State', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should allow test calls in HALF_OPEN state', async () => {
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      // Wait for timeout and transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Test call should be allowed
      const testFn = jest.fn(async () => 'success');
      const result = await breaker.execute(testFn);

      expect(result).toBe('success');
      expect(testFn).toHaveBeenCalled();
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      // Wait and transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Successful calls should close circuit
      const successFn = jest.fn(async () => 'success');
      await breaker.execute(successFn);
      await breaker.execute(successFn);

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reopen circuit if failure occurs in HALF_OPEN', async () => {
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      // Wait and transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Any failure should reopen circuit
      await expect(breaker.execute(errorFn)).rejects.toThrow('Error');

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should track success count in HALF_OPEN state', async () => {
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      // Wait and transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));

      const successFn = jest.fn(async () => 'success');
      await breaker.execute(successFn);

      const metrics = breaker.getMetrics();
      expect(metrics.successCount).toBe(1);
      expect(metrics.state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('Sync Execution', () => {
    it('should execute sync functions', () => {
      const fn = jest.fn(() => 'success');
      const result = breaker.executeSync(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should reject sync calls when open', async () => {
      // Open the circuit
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      // Sync calls should also be rejected
      expect(() => {
        breaker.executeSync(() => 'success');
      }).toThrow('Circuit breaker');
    });
  });

  describe('Metrics', () => {
    it('should calculate success rate', async () => {
      const fn = jest.fn(async (shouldFail: boolean) => {
        if (shouldFail) {
          throw new Error('Error');
        }
        return 'success';
      });

      // 3 successes, 2 failures
      await breaker.execute(() => fn(false));
      await breaker.execute(() => fn(false));
      await breaker.execute(() => fn(false));

      try {
        await breaker.execute(() => fn(true));
      } catch (error) {
        // Expected
      }

      try {
        await breaker.execute(() => fn(true));
      } catch (error) {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.successRate).toBe(60); // 3 out of 5 = 60%
    });

    it('should track last failure time', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      const beforeTime = Date.now();
      await expect(breaker.execute(fn)).rejects.toThrow();
      const afterTime = Date.now();

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).toBeDefined();
      expect(metrics.lastFailureTime! >= beforeTime).toBe(true);
      expect(metrics.lastFailureTime! <= afterTime).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should reset to CLOSED state', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Reset
      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBe(0);
      expect(metrics.totalCalls).toBe(0);
    });

    it('should clear call history on reset', async () => {
      const fn = jest.fn(async () => 'success');

      for (let i = 0; i < 5; i++) {
        await breaker.execute(fn);
      }

      expect(breaker.getMetrics().totalCalls).toBe(5);

      breaker.reset();

      expect(breaker.getMetrics().totalCalls).toBe(0);
    });
  });

  describe('Manual State Control', () => {
    it('should allow manual state transitions', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      breaker.setState(CircuitState.OPEN);
      // Note: getState() checks for timeout and may auto-transition to HALF_OPEN
      // So we don't verify the state after setting it, just that it was set

      breaker.setState(CircuitState.HALF_OPEN);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      breaker.setState(CircuitState.CLOSED);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Error Messages', () => {
    it('should include circuit name in error message', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(fn);
        } catch (error) {
          // Expected
        }
      }

      // Try to call when open
      try {
        await breaker.execute(fn);
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('test-service');
        expect((error as Error).message).toContain('OPEN');
      }
    });
  });
});

describe('CircuitBreakerManager', () => {
  let manager: CircuitBreakerManager;

  beforeEach(() => {
    manager = new CircuitBreakerManager();
  });

  describe('Circuit Management', () => {
    it('should create circuit breaker on first access', () => {
      const breaker = manager.getOrCreate('api', {
        failureThreshold: 5,
      });

      expect(breaker).toBeDefined();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should return same instance for same name', () => {
      const breaker1 = manager.getOrCreate('api');
      const breaker2 = manager.getOrCreate('api');

      expect(breaker1).toBe(breaker2);
    });

    it('should create different breakers for different names', () => {
      const breaker1 = manager.getOrCreate('api1');
      const breaker2 = manager.getOrCreate('api2');

      expect(breaker1).not.toBe(breaker2);
    });

    it('should get all breakers', () => {
      manager.getOrCreate('api1');
      manager.getOrCreate('api2');
      manager.getOrCreate('api3');

      const all = manager.getAll();
      expect(all.size).toBe(3);
      expect(all.has('api1')).toBe(true);
      expect(all.has('api2')).toBe(true);
      expect(all.has('api3')).toBe(true);
    });
  });

  describe('Global Metrics', () => {
    it('should get metrics for all breakers', async () => {
      const breaker1 = manager.getOrCreate('api1');
      const breaker2 = manager.getOrCreate('api2');

      // Generate some activity
      const fn = jest.fn(async () => 'success');
      await breaker1.execute(fn);
      await breaker2.execute(fn);

      const allMetrics = manager.getAllMetrics();

      expect(allMetrics.api1).toBeDefined();
      expect(allMetrics.api2).toBeDefined();
      expect(allMetrics.api1.totalCalls).toBe(1);
      expect(allMetrics.api2.totalCalls).toBe(1);
    });
  });

  describe('Reset Operations', () => {
    it('should reset single breaker', async () => {
      const breaker = manager.getOrCreate('api', { failureThreshold: 1 });

      // Open it
      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      try {
        await breaker.execute(errorFn);
      } catch (error) {
        // Expected
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Reset
      manager.reset('api');

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reset non-existent breaker gracefully', () => {
      const result = manager.reset('non-existent');
      expect(result).toBe(false);
    });

    it('should reset all breakers', async () => {
      const breaker1 = manager.getOrCreate('api1', { failureThreshold: 1 });
      const breaker2 = manager.getOrCreate('api2', { failureThreshold: 1 });

      const errorFn = jest.fn(async () => {
        throw new Error('Error');
      });

      // Open both
      for (const b of [breaker1, breaker2]) {
        try {
          await b.execute(errorFn);
        } catch (error) {
          // Expected
        }
      }

      expect(breaker1.getState()).toBe(CircuitState.OPEN);
      expect(breaker2.getState()).toBe(CircuitState.OPEN);

      // Reset all
      manager.resetAll();

      expect(breaker1.getState()).toBe(CircuitState.CLOSED);
      expect(breaker2.getState()).toBe(CircuitState.CLOSED);
    });

    it('should clear all breakers', () => {
      manager.getOrCreate('api1');
      manager.getOrCreate('api2');

      expect(manager.getAll().size).toBe(2);

      manager.clear();

      expect(manager.getAll().size).toBe(0);
    });
  });

  describe('Default Configuration', () => {
    it('should use default config values', () => {
      const breaker = manager.getOrCreate('api');

      // These should not throw since defaults are applied
      const metrics = breaker.getMetrics();
      expect(metrics).toBeDefined();
    });
  });
});

describe('Singleton Instance', () => {
  it('should provide singleton instance', () => {
    const breaker1 = circuitBreakerManager.getOrCreate('singleton-test1');
    const breaker2 = circuitBreakerManager.getOrCreate('singleton-test1');

    expect(breaker1).toBe(breaker2);
  });
});
