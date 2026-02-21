import { DatabaseManager } from '../src/services/database';
import {
  SyncCheckpointService,
  CheckpointStatus,
} from '../src/services/sync-checkpoint';
import * as path from 'path';

describe('SyncCheckpointService', () => {
  let db: DatabaseManager;
  let service: SyncCheckpointService;
  const testDbPath = ':memory:';

  beforeEach(() => {
    db = new DatabaseManager(testDbPath);
    service = new SyncCheckpointService(db);
    service.initializeSchema();
  });

  describe('Schema Initialization', () => {
    it('should create sync_checkpoints table', () => {
      const rawDb = (db as any).db;
      const tables = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_checkpoints'"
        )
        .all();
      expect(tables.length).toBeGreaterThan(0);
    });

    it('should create processed_items table', () => {
      const rawDb = (db as any).db;
      const tables = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='processed_items'"
        )
        .all();
      expect(tables.length).toBeGreaterThan(0);
    });

    it('should create indexes for performance', () => {
      const rawDb = (db as any).db;
      const indexes = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
        )
        .all();
      expect(indexes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Checkpoint Creation', () => {
    it('should create a new checkpoint', () => {
      const checkpoint = service.createCheckpoint('sync-123', 'sync', 100);

      expect(checkpoint.syncId).toBe('sync-123');
      expect(checkpoint.operation).toBe('sync');
      expect(checkpoint.totalItems).toBe(100);
      expect(checkpoint.status).toBe(CheckpointStatus.IN_PROGRESS);
      expect(checkpoint.processedItems).toBe(0);
      expect(checkpoint.failedItems).toBe(0);
    });

    it('should not allow duplicate sync IDs', () => {
      service.createCheckpoint('sync-123', 'sync', 100);

      expect(() => {
        service.createCheckpoint('sync-123', 'sync', 50);
      }).toThrow();
    });

    it('should return checkpoint with timestamps', () => {
      const checkpoint = service.createCheckpoint('sync-abc', 'sync', 50);

      expect(checkpoint.createdAt).toBeDefined();
      expect(checkpoint.updatedAt).toBeDefined();
    });
  });

  describe('Checkpoint Retrieval', () => {
    it('should retrieve checkpoint by sync ID', () => {
      const created = service.createCheckpoint('sync-001', 'sync', 200);
      const retrieved = service.getCheckpoint('sync-001');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.syncId).toBe('sync-001');
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent checkpoint', () => {
      const retrieved = service.getCheckpoint('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should retrieve multiple checkpoints independently', () => {
      const cp1 = service.createCheckpoint('sync-001', 'sync', 100);
      const cp2 = service.createCheckpoint('sync-002', 'sync', 200);

      const r1 = service.getCheckpoint('sync-001');
      const r2 = service.getCheckpoint('sync-002');

      expect(r1?.id).toBe(cp1.id);
      expect(r2?.id).toBe(cp2.id);
    });
  });

  describe('Item Processing Tracking', () => {
    it('should mark item as success', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);
      service.markItemSuccess(checkpoint.id, 1);

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('should mark item as failed', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);
      service.markItemFailed(checkpoint.id, 1, 'Network error');

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(1);
      expect(stats.processed).toBe(0);
    });

    it('should handle multiple item statuses', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 2);
      service.markItemFailed(checkpoint.id, 3, 'Error 1');
      service.markItemFailed(checkpoint.id, 4, 'Error 2');

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.processed).toBe(2);
      expect(stats.failed).toBe(2);
      expect(stats.pending).toBe(96);
    });

    it('should allow retrying failed items', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);

      // Mark as failed first
      service.markItemFailed(checkpoint.id, 1, 'Error');
      let stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(1);

      // Mark as success (retry)
      service.markItemSuccess(checkpoint.id, 1);
      stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(0);
      expect(stats.processed).toBe(1);
    });
  });

  describe('Unprocessed Items', () => {
    it('should return all items as unprocessed initially', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 5);
      const items = [1, 2, 3, 4, 5];

      const unprocessed = service.getUnprocessedItems(checkpoint.id, items);
      expect(unprocessed).toEqual(items);
    });

    it('should exclude successfully processed items', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 5);
      const items = [1, 2, 3, 4, 5];

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 3);

      const unprocessed = service.getUnprocessedItems(checkpoint.id, items);
      expect(unprocessed).toEqual([2, 4, 5]);
    });

    it('should include failed items in unprocessed', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 5);
      const items = [1, 2, 3, 4, 5];

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemFailed(checkpoint.id, 2, 'Error');

      const unprocessed = service.getUnprocessedItems(checkpoint.id, items);
      expect(unprocessed).toContain(2);
      expect(unprocessed).toContain(3);
      expect(unprocessed).not.toContain(1);
    });

    it('should handle empty item list', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 0);
      const unprocessed = service.getUnprocessedItems(checkpoint.id, []);
      expect(unprocessed).toEqual([]);
    });
  });

  describe('Checkpoint Statistics', () => {
    it('should calculate correct statistics', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 2);
      service.markItemFailed(checkpoint.id, 3);

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.total).toBe(100);
      expect(stats.processed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(97);
    });

    it('should calculate percentage complete', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 10);

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 2);
      service.markItemSuccess(checkpoint.id, 3);
      service.markItemSuccess(checkpoint.id, 4);
      service.markItemSuccess(checkpoint.id, 5);
      service.markItemFailed(checkpoint.id, 6);

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.percentComplete).toBe(60); // 6 out of 10
    });

    it('should return zero stats for non-existent checkpoint', () => {
      const stats = service.getCheckpointStats(9999);

      expect(stats.total).toBe(0);
      expect(stats.processed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.percentComplete).toBe(0);
    });
  });

  describe('Checkpoint Completion', () => {
    it('should mark checkpoint as completed', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 10);
      const completed = service.completeCheckpoint(
        checkpoint.id,
        CheckpointStatus.COMPLETED
      );

      expect(completed.status).toBe(CheckpointStatus.COMPLETED);
    });

    it('should mark checkpoint as failed', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 10);
      const failed = service.completeCheckpoint(
        checkpoint.id,
        CheckpointStatus.FAILED
      );

      expect(failed.status).toBe(CheckpointStatus.FAILED);
    });

    it('should preserve processing stats on completion', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 2);
      service.markItemFailed(checkpoint.id, 3);

      const completed = service.completeCheckpoint(
        checkpoint.id,
        CheckpointStatus.COMPLETED
      );

      expect(completed.processedItems).toBe(2);
      expect(completed.failedItems).toBe(1);
    });
  });

  describe('Checkpoint Resumption', () => {
    it('should resume checkpoint with stats', () => {
      const created = service.createCheckpoint('sync-001', 'sync', 100);
      service.markItemSuccess(created.id, 1);
      service.markItemSuccess(created.id, 2);
      service.markItemFailed(created.id, 3);

      const resume = service.resumeCheckpoint('sync-001');

      expect(resume).not.toBeNull();
      expect(resume?.checkpoint.syncId).toBe('sync-001');
      expect(resume?.stats.processed).toBe(2);
      expect(resume?.stats.failed).toBe(1);
      expect(resume?.stats.percentComplete).toBe(3);
    });

    it('should return null for non-existent checkpoint on resume', () => {
      const resume = service.resumeCheckpoint('non-existent');
      expect(resume).toBeNull();
    });
  });

  describe('Checkpoint Cleanup', () => {
    it('should delete checkpoint and associated items', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);
      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 2);

      service.deleteCheckpoint(checkpoint.id);

      const retrieved = service.getCheckpoint('sync-001');
      expect(retrieved).toBeNull();
    });

    it('should clean up old completed checkpoints', () => {
      // Create and complete a checkpoint
      const cp1 = service.createCheckpoint('sync-001', 'sync', 10);
      service.completeCheckpoint(cp1.id, CheckpointStatus.COMPLETED);

      // Create another checkpoint
      const cp2 = service.createCheckpoint('sync-002', 'sync', 10);

      // Cleanup old checkpoints (0 days old - just the completed one)
      const cleaned = service.cleanupOldCheckpoints(0);

      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle large number of items', () => {
      const checkpoint = service.createCheckpoint('sync-large', 'sync', 10000);
      const items = Array.from({ length: 10000 }, (_, i) => i + 1);

      for (let i = 0; i < 5000; i++) {
        service.markItemSuccess(checkpoint.id, items[i]);
      }

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.processed).toBe(5000);
      expect(stats.percentComplete).toBe(50);
    });

    it('should handle items marked multiple times', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 10);

      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 1);
      service.markItemSuccess(checkpoint.id, 1);

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.processed).toBe(1); // Should count only once
    });

    it('should handle checkpoint with no items processed', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 100);
      const stats = service.getCheckpointStats(checkpoint.id);

      expect(stats.processed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(100);
      expect(stats.percentComplete).toBe(0);
    });

    it('should handle very long error messages', () => {
      const checkpoint = service.createCheckpoint('sync-001', 'sync', 10);
      const longError = 'x'.repeat(1000);

      service.markItemFailed(checkpoint.id, 1, longError);

      const stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(1);
    });

    it('should gracefully handle database errors', () => {
      // Try to use service after potential error - should not throw
      expect(() => {
        service.markItemSuccess(9999, 9999);
        service.getUnprocessedItems(9999, [1, 2, 3]);
        service.getCheckpointStats(9999);
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle bulk item updates efficiently', () => {
      const checkpoint = service.createCheckpoint('sync-perf', 'sync', 1000);
      const startTime = Date.now();

      for (let i = 1; i <= 1000; i++) {
        service.markItemSuccess(checkpoint.id, i);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should retrieve unprocessed items quickly', () => {
      const checkpoint = service.createCheckpoint('sync-perf', 'sync', 1000);
      const items = Array.from({ length: 1000 }, (_, i) => i + 1);

      // Mark half as processed
      for (let i = 0; i < 500; i++) {
        service.markItemSuccess(checkpoint.id, items[i]);
      }

      const startTime = Date.now();
      const unprocessed = service.getUnprocessedItems(checkpoint.id, items);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(unprocessed.length).toBe(500);
    });
  });

  describe('Integration Scenarios', () => {
    it('should support resuming an interrupted sync', () => {
      // First attempt - process 3 items then "interrupt"
      const checkpoint1 = service.createCheckpoint('sync-resume', 'sync', 10);
      service.markItemSuccess(checkpoint1.id, 1);
      service.markItemSuccess(checkpoint1.id, 2);
      service.markItemSuccess(checkpoint1.id, 3);

      // Later attempt - resume from same sync
      const resumed = service.resumeCheckpoint('sync-resume');
      expect(resumed?.checkpoint.syncId).toBe('sync-resume');

      // Get unprocessed items
      const allItems = Array.from({ length: 10 }, (_, i) => i + 1);
      const unprocessed = service.getUnprocessedItems(
        resumed!.checkpoint.id,
        allItems
      );

      expect(unprocessed).toEqual([4, 5, 6, 7, 8, 9, 10]);
    });

    it('should track partial failures and retries', () => {
      const checkpoint = service.createCheckpoint(
        'sync-partial',
        'sync',
        100
      );

      // First batch - some failures
      for (let i = 1; i <= 50; i++) {
        if (i % 5 === 0) {
          service.markItemFailed(checkpoint.id, i, 'API timeout');
        } else {
          service.markItemSuccess(checkpoint.id, i);
        }
      }

      let stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(10);
      expect(stats.processed).toBe(40);

      // Retry failed items
      for (let i = 5; i <= 50; i += 5) {
        service.markItemSuccess(checkpoint.id, i);
      }

      stats = service.getCheckpointStats(checkpoint.id);
      expect(stats.failed).toBe(0);
      expect(stats.processed).toBe(50);
    });
  });
});
