# Enhanced Logging - Phase 4 Priority 2

## Overview

This document describes the enhanced logging system implemented in Phase 4 Priority 2. The system provides structured logging with multiple log levels, operation tracing, and optional file logging with daily log rotation.

## Features

### 1. Log Levels

Four log levels are supported with a hierarchical filter:

- **DEBUG (0)**: Detailed diagnostic information, typically only enabled for troubleshooting
- **INFO (1)**: General informational messages about application operation (default)
- **WARN (2)**: Warning messages for potentially problematic situations
- **ERROR (3)**: Error messages for failures that don't stop the application

Usage:

```typescript
Logger.debug('Detailed debugging info');
Logger.info('Operation started', { userId: 123 });
Logger.warn('Rate limit approaching', { remaining: 5 });
Logger.error('Sync failed', error, { retryAttempt: 1 });
```

### 2. Structured Logging with Context

All log entries support optional context data that is included in structured output:

```typescript
// Simple message
Logger.info('Playlist created');

// With context
Logger.info('Playlist created', { 
  playlistId: 123,
  trackCount: 42,
  duration: '2.5s'
});

// Error with context
Logger.error(
  'Playlist creation failed',
  error,
  { playlistId: 123, reason: 'API Error' }
);
```

### 3. Operation Tracing

Track long-running operations with automatic timing:

```typescript
const traceId = Logger.startOperation('Sync Collection');

try {
  // Do work...
} finally {
  Logger.endOperation(traceId, true, { itemsSync: 42 });
  // Or on failure:
  // Logger.endOperation(traceId, false, { error: 'API Error' });
}
```

Each operation gets a unique trace ID that can be passed through logs to correlate related events.

**Output example:**

```
[2:00:35 AM] [INFO ] Operation started: Sync Collection {traceId:"trace-1771667769116-1"}
[2:00:37 AM] [INFO ] Operation completed: Sync Collection {success:true,itemsSync:42} (2345ms) {traceId:"trace-1771667769116-1"}
```

### 4. Console Output

Logs are displayed in a human-readable format:

```
[HH:MM:SS AM/PM] [LEVEL] Message {context}
```

Examples:

```
[2:00:35 AM] [INFO ] Collection synced successfully {count:50}
[2:00:37 AM] [WARN ] Rate limit approaching {remaining:5,resetIn:60}
[2:00:40 AM] [ERROR] Playlist creation failed {error:"Invalid genre"}
```

### 5. Structured JSON File Logging

When NODE_ENV is not 'test', logs are also written to daily log files in JSON format:

**Log file:** `./logs/YYYY-MM-DD.log`

**Each line is a JSON object:**

```json
{
  "timestamp": "2026-02-21T02:00:35.123Z",
  "level": "INFO",
  "message": "Collection synced",
  "context": { "count": 50 },
  "traceId": "trace-1771667769116-1",
  "duration": 2345
}
```

### 6. Daily Log Rotation

Log files are automatically rotated daily. A new log file is created at midnight for each day.

**Configuration:**

```bash
# Set custom log directory (default: ./logs)
export LOG_DIR=/var/log/discogs-manager

# Set log level (default: info)
export LOG_LEVEL=debug
```

## API Reference

### Logger Methods

#### `info(message: string, context?: Record<string, unknown>): void`

Log an informational message.

#### `warn(message: string, context?: Record<string, unknown>): void`

Log a warning message.

#### `error(message: string, error?: Error, context?: Record<string, unknown>): void`

Log an error message with optional Error object and context.

#### `debug(message: string, context?: Record<string, unknown>): void`

Log a debug message (only shown when DEBUG log level is enabled).

#### `startOperation(label: string): string`

Start tracking a long-running operation. Returns a unique trace ID.

#### `endOperation(traceId: string, success: boolean, context?: Record<string, unknown>): void`

End tracking an operation. Logs duration automatically.

#### `setLogLevel(level: LogLevel): void`

Change the log level dynamically.

#### `getLogLevel(): LogLevel`

Get the current log level.

#### `async close(): Promise<void>`

Close any open file handles (for graceful shutdown).

## Usage Examples

### Basic Logging

```typescript
import { Logger, LogLevel } from './utils/logger';

// Set log level
Logger.setLogLevel(LogLevel.INFO);

// Simple logs
Logger.info('Application started');
Logger.warn('Deprecated feature used');
Logger.error('Connection failed', error);
```

### With Context

```typescript
Logger.info('User action', {
  userId: 'user-123',
  action: 'sync',
  collection: 'main'
});

// Output:
// [2:00:35 AM] [INFO ] User action {userId:"user-123",action:"sync",collection:"main"}
```

### Operation Tracing

```typescript
const traceId = Logger.startOperation('Sync Releases');

try {
  const releases = await discogsClient.getCollection('yosemsweet');
  await database.saveReleases(releases);
  Logger.endOperation(traceId, true, { count: releases.length });
} catch (error) {
  Logger.endOperation(traceId, false, { error: error.message });
  throw error;
}
```

### Error Logging

```typescript
try {
  await playlistService.create(title);
} catch (error) {
  Logger.error('Playlist creation failed', error as Error, {
    title,
    userId: 'user-123',
    retryAttempt: attempt
  });
}
```

## Environment Configuration

### LOG_LEVEL

Set the global log level:

```bash
# Debug level - shows all logs
LOG_LEVEL=debug npm run dev

# Warn level - only show warnings and errors
LOG_LEVEL=warn npm run dev
```

### LOG_DIR

Set custom log directory (default: `./logs`):

```bash
# Use system log directory
LOG_DIR=/var/log/discogs-manager npm run dev

# Use project logs
LOG_DIR=./project-logs npm run dev
```

## Performance

The logger is designed to be performant:

- Log writing is non-blocking (uses synchronous file I/O for durability but doesn't block async operations)
- File writes fail gracefully without throwing exceptions
- 100+ logs/second achievable without performance impact
- Context serialization is efficient

## Testing

The logger includes comprehensive tests covering:

- All log levels and filtering
- Structured context logging
- Operation tracing and timing
- File logging with rotation
- Edge cases (long messages, special characters, missing errors)
- Performance (100 logs in <1s)
- Backwards compatibility

Run tests:

```bash
npm test -- tests/logger.test.ts
```

## Integration with Existing Code

The enhanced logger is backwards compatible with existing code:

```typescript
// Old code still works
Logger.info('Message');

// New features available
Logger.info('Message', { context: 'data' });
Logger.startOperation('Task');
```

## Log Analysis

Example: Analyzing logs from a daily file:

```bash
# Count logs by level
cat logs/2026-02-21.log | jq '.level' | sort | uniq -c

# Find all errors
cat logs/2026-02-21.log | jq 'select(.level == "ERROR")'

# Get operation timings
cat logs/2026-02-21.log | jq 'select(.duration) | {message, duration}'

# Trace a specific operation
cat logs/2026-02-21.log | jq 'select(.traceId == "trace-123")'
```

## Future Enhancements

Potential improvements for future phases:

1. **Log Aggregation**: Send logs to external service (ELK, Datadog, etc.)
2. **Custom Formatters**: Support different output formats (XML, YAML, etc.)
3. **Log Sampling**: Reduce log volume for high-frequency operations
4. **Metrics**: Automatic metrics extraction from logs (duration, error rates, etc.)
5. **Async File I/O**: Use promises for truly non-blocking writes
6. **Compression**: Auto-compress old log files
7. **Log Retention**: Auto-delete logs older than N days
