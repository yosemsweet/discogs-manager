import { DatabaseManager } from './database';
import { Logger } from '../utils/logger';

/**
 * Checkpoint status for a sync operation
 */
export enum CheckpointStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Sync checkpoint entry
 */
export interface SyncCheckpoint {
  id: number;
  syncId: string;
  operation: string;
  status: CheckpointStatus;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  lastProcessedId?: number;
  lastProcessedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Processed item entry for checkpoint tracking
 */
export interface ProcessedItem {
  id: number;
  checkpointId: number;
  itemId: number;
  status: 'success' | 'failed';
  error?: string;
  processedAt: string;
}

/**
 * Service for managing sync checkpoints
 * Allows resuming interrupted syncs without re-processing items
 */
export class SyncCheckpointService {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /**
   * Initialize database schema for sync checkpoints
   */
  initializeSchema(): void {
    try {
      const db = (this.db as any).db;

      // Create sync_checkpoints table
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_checkpoints (
          id INTEGER PRIMARY KEY,
          syncId TEXT UNIQUE NOT NULL,
          operation TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'in_progress',
          totalItems INTEGER NOT NULL DEFAULT 0,
          processedItems INTEGER NOT NULL DEFAULT 0,
          failedItems INTEGER NOT NULL DEFAULT 0,
          lastProcessedId INTEGER,
          lastProcessedAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_syncId ON sync_checkpoints(syncId);
        CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_status ON sync_checkpoints(status);
      `);

      // Create processed_items table
      db.exec(`
        CREATE TABLE IF NOT EXISTS processed_items (
          id INTEGER PRIMARY KEY,
          checkpointId INTEGER NOT NULL,
          itemId INTEGER NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          processedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (checkpointId) REFERENCES sync_checkpoints(id) ON DELETE CASCADE,
          UNIQUE(checkpointId, itemId)
        );
        CREATE INDEX IF NOT EXISTS idx_processed_items_checkpointId ON processed_items(checkpointId);
        CREATE INDEX IF NOT EXISTS idx_processed_items_status ON processed_items(status);
      `);

      Logger.debug('Sync checkpoint schema initialized');
    } catch (error) {
      if (
        error instanceof Error &&
        !error.message.includes('already exists')
      ) {
        Logger.warn('Error initializing checkpoint schema', { error: error.message });
      }
    }
  }

  /**
   * Create a new sync checkpoint
   */
  createCheckpoint(
    syncId: string,
    operation: string,
    totalItems: number
  ): SyncCheckpoint {
    try {
      const db = (this.db as any).db;
      const stmt = db.prepare(`
        INSERT INTO sync_checkpoints (syncId, operation, totalItems, status)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(syncId, operation, totalItems, CheckpointStatus.IN_PROGRESS);

      const checkpoint = db
        .prepare('SELECT * FROM sync_checkpoints WHERE syncId = ?')
        .get(syncId) as SyncCheckpoint;

      Logger.info('Sync checkpoint created', {
        syncId,
        operation,
        totalItems,
      });

      return checkpoint;
    } catch (error) {
      Logger.error(
        'Failed to create checkpoint',
        error instanceof Error ? error : new Error(String(error)),
        { syncId, operation }
      );
      throw error;
    }
  }

  /**
   * Get existing checkpoint by sync ID
   */
  getCheckpoint(syncId: string): SyncCheckpoint | null {
    try {
      const db = (this.db as any).db;
      const checkpoint = db
        .prepare('SELECT * FROM sync_checkpoints WHERE syncId = ?')
        .get(syncId) as SyncCheckpoint | undefined;

      return checkpoint || null;
    } catch (error) {
      Logger.debug('Error retrieving checkpoint', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Mark an item as processed successfully
   */
  markItemSuccess(checkpointId: number, itemId: number): void {
    try {
      const db = (this.db as any).db;

      // Insert or update processed item record
      db.prepare(`
        INSERT INTO processed_items (checkpointId, itemId, status)
        VALUES (?, ?, 'success')
        ON CONFLICT(checkpointId, itemId) DO UPDATE SET
          status = 'success',
          error = NULL,
          processedAt = CURRENT_TIMESTAMP
      `).run(checkpointId, itemId);

      // Update checkpoint stats
      db.prepare(`
        UPDATE sync_checkpoints
        SET processedItems = (
          SELECT COUNT(*) FROM processed_items
          WHERE checkpointId = ? AND status = 'success'
        ),
        lastProcessedId = ?,
        lastProcessedAt = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(checkpointId, itemId, checkpointId);
    } catch (error) {
      Logger.warn('Error marking item as success', {
        checkpointId,
        itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Mark an item as failed
   */
  markItemFailed(checkpointId: number, itemId: number, error?: string): void {
    try {
      const db = (this.db as any).db;

      // Insert or update processed item record
      db.prepare(`
        INSERT INTO processed_items (checkpointId, itemId, status, error)
        VALUES (?, ?, 'failed', ?)
        ON CONFLICT(checkpointId, itemId) DO UPDATE SET
          status = 'failed',
          error = ?,
          processedAt = CURRENT_TIMESTAMP
      `).run(checkpointId, itemId, error || null, error || null);

      // Update checkpoint stats
      db.prepare(`
        UPDATE sync_checkpoints
        SET failedItems = (
          SELECT COUNT(*) FROM processed_items
          WHERE checkpointId = ? AND status = 'failed'
        ),
        updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(checkpointId, checkpointId);
    } catch (error) {
      Logger.warn('Error marking item as failed', {
        checkpointId,
        itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get list of items that need to be (re)processed
   */
  getUnprocessedItems(checkpointId: number, allItems: number[]): number[] {
    try {
      const db = (this.db as any).db;

      // Get already processed items
      const processed = db
        .prepare(`
          SELECT DISTINCT itemId FROM processed_items
          WHERE checkpointId = ? AND status = 'success'
        `)
        .all(checkpointId) as Array<{ itemId: number }>;

      const processedIds = new Set(processed.map((p) => p.itemId));

      // Return items that haven't been successfully processed
      return allItems.filter((itemId) => !processedIds.has(itemId));
    } catch (error) {
      Logger.warn('Error getting unprocessed items', {
        checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return all items if we can't get checkpoint data
      return allItems;
    }
  }

  /**
   * Complete a sync checkpoint
   */
  completeCheckpoint(
    checkpointId: number,
    finalStatus: CheckpointStatus = CheckpointStatus.COMPLETED
  ): SyncCheckpoint {
    try {
      const db = (this.db as any).db;

      db.prepare(`
        UPDATE sync_checkpoints
        SET status = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(finalStatus, checkpointId);

      const checkpoint = db
        .prepare('SELECT * FROM sync_checkpoints WHERE id = ?')
        .get(checkpointId) as SyncCheckpoint;

      Logger.info('Sync checkpoint completed', {
        checkpointId,
        status: finalStatus,
        processed: checkpoint.processedItems,
        failed: checkpoint.failedItems,
      });

      return checkpoint;
    } catch (error) {
      Logger.error(
        'Failed to complete checkpoint',
        error instanceof Error ? error : new Error(String(error)),
        { checkpointId }
      );
      throw error;
    }
  }

  /**
   * Clean up old completed checkpoints (optional)
   */
  cleanupOldCheckpoints(daysOld: number = 7): number {
    try {
      const db = (this.db as any).db;

      const result = db
        .prepare(`
          DELETE FROM sync_checkpoints
          WHERE status = ? AND julianday('now') - julianday(updatedAt) > ?
        `)
        .run(CheckpointStatus.COMPLETED, daysOld);

      const deleted = (result as any).changes || 0;
      if (deleted > 0) {
        Logger.info('Cleaned up old checkpoints', { deleted, daysOld });
      }

      return deleted;
    } catch (error) {
      Logger.warn('Error cleaning up old checkpoints', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get checkpoint statistics
   */
  getCheckpointStats(
    checkpointId: number
  ): {
    total: number;
    processed: number;
    failed: number;
    pending: number;
    percentComplete: number;
  } {
    try {
      const db = (this.db as any).db;
      const checkpoint = db
        .prepare('SELECT * FROM sync_checkpoints WHERE id = ?')
        .get(checkpointId) as SyncCheckpoint;

      if (!checkpoint) {
        return {
          total: 0,
          processed: 0,
          failed: 0,
          pending: 0,
          percentComplete: 0,
        };
      }

      // Query actual current status from processed_items, not cached values
      const statusCounts = db
        .prepare(`
          SELECT 
            status,
            COUNT(*) as count
          FROM processed_items
          WHERE checkpointId = ?
          GROUP BY status
        `)
        .all(checkpointId) as Array<{ status: string; count: number }>;

      const statusMap: Record<string, number> = {};
      statusCounts.forEach((row) => {
        statusMap[row.status] = row.count;
      });

      const processed = statusMap['success'] || 0;
      const failed = statusMap['failed'] || 0;
      const pending = checkpoint.totalItems - processed - failed;
      const percentComplete =
        checkpoint.totalItems > 0
          ? Math.round(((processed + failed) / checkpoint.totalItems) * 100)
          : 0;

      return {
        total: checkpoint.totalItems,
        processed,
        failed,
        pending,
        percentComplete,
      };
    } catch (error) {
      Logger.debug('Error getting checkpoint stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        total: 0,
        processed: 0,
        failed: 0,
        pending: 0,
        percentComplete: 0,
      };
    }
  }

  /**
   * Resume from a checkpoint (get stats and last position)
   */
  resumeCheckpoint(
    syncId: string
  ): {
    checkpoint: SyncCheckpoint;
    stats: {
      total: number;
      processed: number;
      failed: number;
      pending: number;
      percentComplete: number;
    };
  } | null {
    const checkpoint = this.getCheckpoint(syncId);
    if (!checkpoint) {
      return null;
    }

    const stats = this.getCheckpointStats(checkpoint.id);
    return { checkpoint, stats };
  }

  /**
   * Delete a checkpoint (cleanup after successful completion)
   */
  deleteCheckpoint(checkpointId: number): void {
    try {
      const db = (this.db as any).db;

      db.prepare('DELETE FROM processed_items WHERE checkpointId = ?').run(
        checkpointId
      );
      db.prepare('DELETE FROM sync_checkpoints WHERE id = ?').run(checkpointId);

      Logger.debug('Checkpoint deleted', { checkpointId });
    } catch (error) {
      Logger.warn('Error deleting checkpoint', {
        checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
