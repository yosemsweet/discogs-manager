# Resilience System

Fault tolerance utilities used across the CLI to handle API failures, timeouts, and interrupted operations.

---

## Components

### Circuit Breaker
**File:** `src/services/circuit-breaker.ts`

Wraps external API calls. After a configurable number of failures, the breaker opens and subsequent calls fail immediately (instead of waiting for a timeout) until a cooldown period passes.

States: `CLOSED` (normal) → `OPEN` (failing fast) → `HALF_OPEN` (testing recovery)

Usage: wrap any async operation with `circuitBreaker.execute(() => apiCall())`.

### Sync Checkpoints
**File:** `src/services/sync-checkpoint.ts`

Allows interrupted collection syncs to resume from where they left off rather than restarting from scratch. Tracks processed/failed release IDs in the `sync_checkpoints` and `processed_items` tables.

Usage: the `sync` command automatically creates and resumes checkpoints.

### Timeout Handler
**File:** `src/services/timeout-handler.ts`

Wraps async operations with a configurable deadline. Supports retry with backoff and cancellation.

Usage: `withTimeout(asyncOperation, { timeout: 30000, retries: 3 })`.

---

## Retry Queue

Failed releases during sync are placed in the `retry_queue` table. Run `npm run dev -- collection retry` to reprocess them. Releases that fail repeatedly are moved to the dead-letter queue (`dlq` table).
