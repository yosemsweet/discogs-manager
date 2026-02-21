# Discogs Manager CLI - Architecture Overview

## Table of Contents

1. [System Overview](#system-overview)
2. [Architectural Layers](#architectural-layers)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Database Schema](#database-schema)
6. [Extension Points](#extension-points)
7. [System Dependencies](#system-dependencies)
8. [Error Handling Strategy](#error-handling-strategy)
9. [Performance Patterns](#performance-patterns)
10. [Security Architecture](#security-architecture)
11. [Adding New Features](#adding-new-features)

---

## System Overview

Discogs Manager CLI is built using a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────┐
│          CLI Entry Point (index.ts)         │
│     Commander.js + Environment Config       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           Command Layer (commands/)         │
│   sync, list, stats, playlist, auth, retry │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          Service Layer (services/)          │
│  Collection, Playlist, Database, OAuth      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│            API Layer (api/)                 │
│      Discogs API + SoundCloud API          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│        External Services                    │
│   Discogs.com + SoundCloud.com + SQLite    │
└─────────────────────────────────────────────┘
```

### Design Principles

1. **Separation of Concerns**: Each layer has a single, well-defined responsibility
2. **Dependency Injection**: Services receive dependencies via constructor injection
3. **Error Isolation**: Errors are caught at boundaries and transformed appropriately
4. **Immutable Data Flow**: Data flows downward, transformations return new objects
5. **Async-First**: All I/O operations are asynchronous (Promises/async-await)

---

## Architectural Layers

### 1. CLI Entry Point Layer (`src/index.ts`)

**Purpose**: Application bootstrap and dependency wiring

**Responsibilities**:
- Load environment configuration via `dotenv`
- Initialize API clients (Discogs, SoundCloud)
- Initialize database manager
- Register commands with Commander.js
- Handle global errors and exit codes

**Key Code**:
```typescript
const discogsClient = new DiscogsAPIClient(token, username);
const soundcloudClient = new SoundCloudAPIClient(accessToken);
const db = new DatabaseManager(dbPath);

program.addCommand(createSyncCommand(discogsClient, db));
program.addCommand(createListCommand(discogsClient, db));
// ... other commands
```

**Extension Point**: Add new commands by importing and registering them here.

---

### 2. Command Layer (`src/commands/`)

**Purpose**: Handle CLI interactions and orchestrate services

**Files**:
- `sync.ts` - Collection synchronization command
- `list.ts` - Collection browsing command
- `stats.ts` - Statistics and analytics command
- `playlist.ts` - SoundCloud playlist creation command
- `auth.ts` - OAuth authentication command
- `retry.ts` - Retry queue processing command

**Responsibilities**:
- Parse command-line options and arguments
- Validate user inputs
- Create progress indicators (spinners)
- Call service layer methods
- Format and display results
- Handle command-specific errors
- Manage process exit codes

**Pattern**: All commands use the `CommandBuilder` utility for consistent error handling:

```typescript
export function createSyncCommand(discogsClient, db) {
  const cmd = new Command('sync')
    .description('Sync your Discogs collection')
    .option('-f, --force', 'Force refresh');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();
    try {
      const validated = Validator.validateSyncOptions(options);
      const service = new CollectionService(discogsClient, db);
      const progressCallback = CommandBuilder.createProgressCallback(spinner);

      const count = await service.syncCollection(
        validated.username,
        progressCallback,
        validated.force
      );

      spinner.succeed(`Synced ${count} releases`);
      process.exit(0);
    } catch (error) {
      spinner.fail(error.message);
      process.exit(1);
    }
  });

  return cmd;
}
```

**Extension Point**: Add new commands by creating a file in `src/commands/` and registering in `index.ts`.

---

### 3. Service Layer (`src/services/`)

**Purpose**: Business logic and orchestration of data operations

**Core Services**:

#### CollectionService (`collection.ts`)
- Syncs Discogs collections to local database
- Filters releases by genre, year, rating, style
- Manages retry queue and DLQ
- Provides collection statistics

**Key Methods**:
```typescript
class CollectionService {
  async syncCollection(username, onProgress, forceRefresh): Promise<number>
  async syncSpecificReleases(username, releaseIds, onProgress, forceRefresh): Promise<number>
  async listReleases(username, filter): Promise<StoredRelease[]>
  async getStats(username): Promise<CollectionStats>
  async filterReleases(filter): Promise<StoredRelease[]>
}
```

#### PlaylistService (`playlist.ts`)
- Creates SoundCloud playlists from filtered releases
- Orchestrates track searching and playlist building
- Delegates to specialized sub-services

**Dependencies**:
- `TrackSearchService` - Finds tracks on SoundCloud
- `PlaylistBatchManager` - Batch API operations

**Key Methods**:
```typescript
class PlaylistService {
  async createPlaylist(title, description, filter): Promise<PlaylistInfo>
  async addTracksToPlaylist(playlistId, tracks): Promise<number>
}
```

#### DatabaseManager (`database.ts`)
- Manages SQLite database connections
- Provides CRUD operations for all tables
- Handles schema migrations
- Manages transactions

**Key Methods**:
```typescript
class DatabaseManager {
  async addRelease(release): Promise<void>
  async releaseExists(discogsId): Promise<boolean>
  async getAllReleases(): Promise<StoredRelease[]>
  async getReleasesByFilter(filter): Promise<StoredRelease[]>
  async addToRetryQueue(releaseId, username, error): Promise<void>
  async moveToDLQ(releaseId, username, error): Promise<void>
}
```

#### SoundCloudOAuthService (`soundcloud-oauth.ts`)
- Manages OAuth 2.1 authentication flow
- Encrypts/decrypts tokens using AES-256-GCM
- Auto-refreshes tokens before expiration
- Stores tokens in database

**Key Methods**:
```typescript
class SoundCloudOAuthService {
  async getValidAccessToken(): Promise<string>
  async refreshAccessToken(): Promise<void>
  async storeTokens(accessToken, refreshToken, expiresIn): Promise<void>
}
```

#### Supporting Services:

- **CircuitBreakerService** (`circuit-breaker.ts`) - Prevents cascading failures
- **SyncCheckpointService** (`sync-checkpoint.ts`) - Resume interrupted syncs
- **TimeoutHandler** (`timeout-handler.ts`) - Timeout management with retries
- **TrackSearchService** (`track-search.ts`) - SoundCloud track searching
- **PlaylistBatchManager** (`playlist-batch.ts`) - Batch playlist operations
- **SoundCloudRateLimitService** (`soundcloud-rate-limit.ts`) - Rate limit tracking

**Extension Point**: Add new services by creating files in `src/services/` and injecting them into commands.

---

### 4. API Layer (`src/api/`)

**Purpose**: Communicate with external APIs

#### DiscogsAPIClient (`discogs.ts`)

**Responsibilities**:
- HTTP requests to Discogs API
- Rate limiting (60 requests per 60-second window)
- Automatic retries with exponential backoff
- Request throttling when approaching limits
- Error parsing and classification

**Key Methods**:
```typescript
class DiscogsAPIClient {
  async getCollection(username, page): Promise<CollectionPage>
  async getCollectionPaginated(username): Promise<{ releases, pagination }>
  async getRelease(releaseId): Promise<ReleaseDetails>
}
```

**Rate Limiting Strategy**:
- Tracks remaining requests via `X-Discogs-Ratelimit-Remaining` header
- Pauses for 60 seconds when remaining ≤ 2
- Logs warnings when approaching limit
- Automatic retry on 429 responses

#### SoundCloudAPIClient (`soundcloud.ts`)

**Responsibilities**:
- HTTP requests to SoundCloud API
- OAuth token management (via SoundCloudOAuthService)
- Rate limiting (15,000 requests per 24 hours)
- Track searching and playlist operations

**Key Methods**:
```typescript
class SoundCloudAPIClient {
  async searchTracks(query): Promise<Track[]>
  async createPlaylist(title, description): Promise<Playlist>
  async addTrackToPlaylist(playlistId, trackId): Promise<void>
  async getUserId(): Promise<number>
}
```

**Extension Point**: Add new API clients by creating files in `src/api/` following the same pattern.

---

### 5. Utilities Layer (`src/utils/`)

**Purpose**: Reusable helper functions and utilities

#### Error Handling (`error-handler.ts`)

**13 Error Types**:
- `VALIDATION_ERROR` - Invalid user input
- `AUTHENTICATION_ERROR` - Invalid credentials
- `AUTHORIZATION_ERROR` - Insufficient permissions
- `RATE_LIMIT_ERROR` - API rate limit exceeded
- `NOT_FOUND_ERROR` - Resource not found (404)
- `NETWORK_ERROR` - Network connectivity issues
- `TIMEOUT_ERROR` - Request timeout
- `DATABASE_ERROR` - Database operation failed
- `EXTERNAL_API_ERROR` - Third-party API failure
- `CONFIGURATION_ERROR` - Missing or invalid configuration
- `ENCRYPTION_ERROR` - Encryption/decryption failure
- `UNKNOWN_ERROR` - Unclassified errors
- `VALIDATION_ERROR` - Schema validation failure

**Key Class**:
```typescript
class ErrorHandler {
  static handle(error, context): AppError
  static parseAxiosError(error, context): AppError
  static logError(error, context): void
}
```

#### Other Utilities:

- **Logger** (`logger.ts`) - Structured JSON logging with trace IDs
- **Cache** (`cache.ts`) - In-memory caching with TTL
- **QueryBuilder** (`query-builder.ts`) - SQL query builder
- **ConcurrencyManager** (`concurrency.ts`) - Parallel task execution
- **Validator** (`validator.ts`) - Input validation
- **Encryption** (`encryption.ts`) - AES-256-GCM encryption
- **Progress** (`progress.ts`) - Progress callback abstraction
- **Formatters** (`formatters.ts`) - Output formatting helpers
- **CommandBuilder** (`command-builder.ts`) - Command pattern helpers
- **Sanitizer** (`sanitizer.ts`) - Input sanitization
- **Retry** (`retry.ts`) - Retry logic with backoff

**Extension Point**: Add new utilities as needed, keeping them stateless and pure when possible.

---

## Core Components

### Dependency Graph

```
index.ts
  ├─ DiscogsAPIClient
  ├─ SoundCloudAPIClient
  │   └─ SoundCloudOAuthService
  │       └─ DatabaseManager
  ├─ DatabaseManager
  └─ Commands
      ├─ sync
      │   └─ CollectionService
      │       ├─ DiscogsAPIClient
      │       └─ DatabaseManager
      ├─ list
      │   └─ CollectionService
      ├─ stats
      │   └─ CollectionService
      ├─ playlist
      │   └─ PlaylistService
      │       ├─ TrackSearchService
      │       │   └─ SoundCloudAPIClient
      │       ├─ PlaylistBatchManager
      │       │   └─ SoundCloudAPIClient
      │       └─ DatabaseManager
      ├─ auth
      │   └─ SoundCloudOAuthService
      └─ retry
          └─ DatabaseManager
```

### Tightly Coupled Systems

#### 1. Command ↔ Service Coupling
**Nature**: Commands are tightly coupled to their corresponding services.

**Reason**: Each command has specific business logic requirements.

**Example**:
- `sync` command → `CollectionService.syncCollection()`
- `playlist` command → `PlaylistService.createPlaylist()`

**Decoupling Strategy**: Commands only call service methods; services don't know about commands.

#### 2. Service ↔ Database Coupling
**Nature**: Services are coupled to `DatabaseManager`.

**Reason**: All persistence goes through the database.

**Mitigation**: DatabaseManager provides a stable interface; schema changes don't affect services.

#### 3. API Client ↔ External Service Coupling
**Nature**: API clients are tightly coupled to Discogs/SoundCloud APIs.

**Reason**: They implement specific API contracts.

**Mitigation**: Services depend on API client interfaces, not implementations.

### Loosely Coupled Systems

#### 1. Services ↔ Utilities
**Nature**: Services use utilities, but utilities don't know about services.

**Example**: `Logger`, `Cache`, `Validator` are used by services but remain independent.

#### 2. Commands ↔ Utilities
**Nature**: Commands use utilities like `CommandBuilder` and `Validator`.

**Benefit**: Utilities can be changed without affecting command logic.

#### 3. Error Handling
**Nature**: Centralized error handling via `ErrorHandler`.

**Benefit**: Error classification and logging logic is isolated.

---

## Data Flow

### Sync Command Flow

```
1. User runs: npm run dev -- sync

2. CLI Entry (index.ts)
   └─ Creates DiscogsAPIClient, DatabaseManager
   └─ Registers sync command
   └─ Parses arguments

3. Sync Command (commands/sync.ts)
   └─ Validates options (Validator)
   └─ Creates CollectionService
   └─ Creates progress callback
   └─ Calls service.syncCollection()

4. Collection Service (services/collection.ts)
   └─ Calls discogsClient.getCollectionPaginated()
   └─ For each release:
       ├─ Checks if exists in DB (skip if yes)
       ├─ Fetches details: discogsClient.getRelease()
       ├─ Stores in DB: db.addRelease()
       └─ On error: db.addToRetryQueue()

5. Discogs API Client (api/discogs.ts)
   └─ Makes HTTP request to Discogs
   └─ Checks rate limit headers
   └─ Throttles if needed
   └─ Returns data or throws error

6. Database Manager (services/database.ts)
   └─ Executes SQL INSERT/UPDATE
   └─ Returns success/failure

7. Command completes
   └─ Shows success message
   └─ Exits with code 0
```

### Playlist Creation Flow

```
1. User runs: npm run dev -- playlist --title "Rock" --genres "Rock"

2. CLI Entry (index.ts)
   └─ Creates SoundCloudAPIClient, DatabaseManager
   └─ Registers playlist command

3. Playlist Command (commands/playlist.ts)
   └─ Validates options
   └─ Creates PlaylistService
   └─ Calls service.createPlaylist()

4. Playlist Service (services/playlist.ts)
   └─ Filters releases from DB (by genre)
   └─ Creates SoundCloud playlist via API
   └─ For each release:
       ├─ TrackSearchService.searchTrack()
       ├─ Collects track IDs
   └─ PlaylistBatchManager.addTracksToPlaylist()

5. Track Search Service (services/track-search.ts)
   └─ Constructs search query
   └─ Calls soundcloudClient.searchTracks()
   └─ Returns best match

6. SoundCloud API Client (api/soundcloud.ts)
   └─ Gets valid token: oauthService.getValidAccessToken()
   └─ Makes HTTP request to SoundCloud
   └─ Returns tracks

7. Playlist Batch Manager (services/playlist-batch.ts)
   └─ Chunks tracks into batches
   └─ Calls soundcloudClient.addTrackToPlaylist() for each
   └─ Handles rate limiting

8. Command completes
   └─ Shows playlist URL
   └─ Exits with code 0
```

---

## Database Schema

### Tables

#### `releases`
Stores Discogs release metadata.

```sql
CREATE TABLE releases (
  id INTEGER PRIMARY KEY,
  discogsId INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL,
  artists TEXT NOT NULL,
  year INTEGER,
  genres TEXT,
  styles TEXT,
  condition TEXT,
  rating INTEGER,
  addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_releases_year ON releases(year);
CREATE INDEX idx_releases_genres ON releases(genres);
```

#### `tracks`
Stores individual tracks from releases.

```sql
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  releaseId INTEGER NOT NULL,
  title TEXT NOT NULL,
  artists TEXT,
  position TEXT,
  duration TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (releaseId) REFERENCES releases(discogsId),
  UNIQUE(releaseId, position)
);

CREATE INDEX idx_tracks_releaseId ON tracks(releaseId);
```

#### `playlists`
Stores created SoundCloud playlists.

```sql
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  soundcloudId TEXT UNIQUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `playlist_releases`
Many-to-many relationship between playlists and releases.

```sql
CREATE TABLE playlist_releases (
  playlistId TEXT NOT NULL,
  releaseId INTEGER NOT NULL,
  soundcloudTrackId TEXT,
  PRIMARY KEY (playlistId, releaseId),
  FOREIGN KEY (playlistId) REFERENCES playlists(id),
  FOREIGN KEY (releaseId) REFERENCES releases(discogsId)
);
```

#### `retry_queue`
Failed releases pending retry.

```sql
CREATE TABLE retry_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  releaseId INTEGER NOT NULL,
  username TEXT NOT NULL,
  attemptCount INTEGER DEFAULT 1,
  lastError TEXT,
  lastAttemptAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_retry_queue_username ON retry_queue(username);
```

#### `dlq` (Dead Letter Queue)
Permanently failed releases.

```sql
CREATE TABLE dlq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  releaseId INTEGER NOT NULL,
  username TEXT NOT NULL,
  errorMessage TEXT,
  lastAttemptAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dlq_username ON dlq(username);
```

#### `soundcloud_rate_limit`
SoundCloud API rate limit state.

```sql
CREATE TABLE soundcloud_rate_limit (
  id INTEGER PRIMARY KEY,
  remaining INTEGER DEFAULT 15000,
  resetTime DATETIME,
  maxRequests INTEGER DEFAULT 15000,
  lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `soundcloud_tokens`
Encrypted OAuth tokens.

```sql
CREATE TABLE soundcloud_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token_encrypted TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  access_token_auth_tag TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  refresh_token_auth_tag TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `sync_checkpoints`
Resumable sync state.

```sql
CREATE TABLE sync_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  sync_id TEXT UNIQUE NOT NULL,
  total_items INTEGER NOT NULL,
  processed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
```

#### `processed_items`
Track which items have been processed in a sync.

```sql
CREATE TABLE processed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sync_id) REFERENCES sync_checkpoints(sync_id),
  UNIQUE(sync_id, item_id)
);
```

---

## Extension Points

### 1. Adding a New Command

**Steps**:
1. Create `src/commands/your-command.ts`
2. Define command with Commander.js
3. Use `CommandBuilder` for error handling
4. Create or use existing service
5. Register in `src/index.ts`

**Example**:
```typescript
// src/commands/export.ts
import { Command } from 'commander';
import { CommandBuilder } from '../utils/command-builder';
import { DatabaseManager } from '../services/database';

export function createExportCommand(db: DatabaseManager) {
  const cmd = new Command('export')
    .description('Export collection to CSV')
    .option('-o, --output <file>', 'Output file path');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();
    try {
      const releases = await db.getAllReleases();
      // ... export logic
      spinner.succeed('Exported successfully');
      process.exit(0);
    } catch (error) {
      spinner.fail(error.message);
      process.exit(1);
    }
  });

  return cmd;
}

// src/index.ts
import { createExportCommand } from './commands/export';
program.addCommand(createExportCommand(db));
```

### 2. Adding a New Service

**Steps**:
1. Create `src/services/your-service.ts`
2. Define service class with dependencies in constructor
3. Implement business logic methods
4. Inject into commands that need it

**Example**:
```typescript
// src/services/analytics.ts
export class AnalyticsService {
  constructor(private db: DatabaseManager) {}

  async getGenreTrends(): Promise<GenreTrend[]> {
    // Implementation
  }

  async getYearDistribution(): Promise<YearStats[]> {
    // Implementation
  }
}

// src/commands/analytics.ts
const analyticsService = new AnalyticsService(db);
const trends = await analyticsService.getGenreTrends();
```

### 3. Adding a New API Client

**Steps**:
1. Create `src/api/your-api.ts`
2. Implement HTTP client with axios
3. Add rate limiting if needed
4. Handle errors appropriately
5. Inject into services

**Example**:
```typescript
// src/api/spotify.ts
export class SpotifyAPIClient {
  private client: AxiosInstance;

  constructor(accessToken: string) {
    this.client = axios.create({
      baseURL: 'https://api.spotify.com/v1',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  async searchTrack(query: string): Promise<Track[]> {
    const response = await this.client.get('/search', {
      params: { q: query, type: 'track' }
    });
    return response.data.tracks.items;
  }
}
```

### 4. Adding a New Database Table

**Steps**:
1. Update `DatabaseManager.initializeDatabase()` with new schema
2. Add CRUD methods to `DatabaseManager`
3. Update TypeScript types in `src/types/index.ts`
4. Use in services

**Example**:
```typescript
// In DatabaseManager.initializeDatabase()
this.db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add methods
async getSetting(key: string): Promise<string | null> {
  const stmt = this.db.prepare('SELECT value FROM user_settings WHERE key = ?');
  const result = stmt.get(key);
  return result ? result.value : null;
}

async setSetting(key: string, value: string): Promise<void> {
  const stmt = this.db.prepare(
    'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)'
  );
  stmt.run(key, value);
}
```

### 5. Adding a New Utility

**Steps**:
1. Create `src/utils/your-utility.ts`
2. Implement as pure functions or stateless class
3. Export functions/class
4. Import and use in services/commands

**Example**:
```typescript
// src/utils/csv-exporter.ts
export class CSVExporter {
  static exportReleases(releases: StoredRelease[]): string {
    const headers = ['Title', 'Artists', 'Year', 'Genres'];
    const rows = releases.map(r => [
      r.title,
      r.artists,
      r.year,
      r.genres
    ]);

    return [headers, ...rows]
      .map(row => row.join(','))
      .join('\n');
  }
}
```

### 6. Extending Error Handling

**Steps**:
1. Add new error type to `ErrorType` enum in `error-handler.ts`
2. Update `ErrorHandler.handle()` to recognize new type
3. Add appropriate logging and recovery logic

**Example**:
```typescript
// Add to ErrorType enum
export enum ErrorType {
  // ... existing types
  SPOTIFY_API_ERROR = 'SPOTIFY_API_ERROR',
}

// In ErrorHandler.handle()
if (error.message.includes('Spotify')) {
  return new AppError(
    ErrorType.SPOTIFY_API_ERROR,
    'Spotify API error',
    undefined,
    error,
    context
  );
}
```

---

## System Dependencies

### External Dependencies

| Dependency | Purpose | Coupling Level | Replacement Difficulty |
|------------|---------|----------------|------------------------|
| **Discogs API** | Source of collection data | High | Very Hard - core feature |
| **SoundCloud API** | Playlist creation | Medium | Medium - could add Spotify/Apple Music |
| **SQLite** | Local data storage | High | Hard - but could migrate to PostgreSQL |
| **Commander.js** | CLI framework | Low | Easy - minimal API surface |
| **Axios** | HTTP client | Low | Easy - could use fetch or other client |
| **better-sqlite3** | SQLite binding | Medium | Medium - could use node-sqlite3 |

### Internal Dependencies

| Component | Depends On | Coupling | Notes |
|-----------|------------|----------|-------|
| **Commands** | Services, Utils | Tight | Commands orchestrate services |
| **Services** | API Clients, Database | Tight | Business logic layer |
| **API Clients** | Axios, Utils | Loose | Can be mocked/replaced |
| **Database** | better-sqlite3 | Tight | Could abstract with repository pattern |
| **Utilities** | None | None | Pure functions, stateless |

### Decoupling Strategies

1. **Interface Segregation**: Define interfaces for services and inject them
2. **Dependency Injection**: Pass dependencies via constructors
3. **Repository Pattern**: Abstract database access behind interfaces
4. **Adapter Pattern**: Wrap external APIs with internal interfaces
5. **Factory Pattern**: Create complex objects via factories

---

## Error Handling Strategy

### Error Flow

```
1. Error occurs (API, Database, etc.)
   ↓
2. Caught at boundary (API client, Database)
   ↓
3. Transformed to AppError with appropriate ErrorType
   ↓
4. Propagated to Service layer
   ↓
5. Service decides: Retry, Queue, or Fail
   ↓
6. Logged via Logger with context
   ↓
7. Returned to Command layer
   ↓
8. Command displays user-friendly message
   ↓
9. Process exits with appropriate code
```

### Retry Strategies

| Error Type | Strategy | Max Retries | Backoff |
|------------|----------|-------------|---------|
| **Network Error** | Exponential backoff | 3 | 1s, 2s, 4s |
| **Rate Limit (429)** | Fixed delay | 3 | 60s |
| **Timeout** | Linear backoff | 2 | 5s, 10s |
| **404 Not Found** | No retry (move to DLQ) | 0 | N/A |
| **5xx Server Error** | Exponential backoff | 3 | 2s, 4s, 8s |
| **Auth Error (401)** | Refresh token once | 1 | Immediate |

### Circuit Breaker Pattern

**States**: CLOSED, OPEN, HALF_OPEN

**Transition Logic**:
- CLOSED → OPEN: After N consecutive failures
- OPEN → HALF_OPEN: After timeout period
- HALF_OPEN → CLOSED: After M consecutive successes
- HALF_OPEN → OPEN: On any failure

**Usage**:
```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000
});

const result = await breaker.execute(async () => {
  return await apiClient.makeRequest();
});
```

---

## Performance Patterns

### 1. Caching Layer

**CacheService** provides in-memory caching with TTL:

```typescript
const cache = CacheService.getInstance();

// Cache Discogs collection for 24 hours
const cacheKey = `collection:${username}`;
let collection = cache.get(cacheKey);

if (!collection) {
  collection = await discogsClient.getCollectionPaginated(username);
  cache.set(cacheKey, collection, 24 * 60 * 60 * 1000); // 24 hours
}
```

### 2. Database Optimization

**Query Builder** with prepared statements:

```typescript
const qb = new QueryBuilder('releases');
const query = qb
  .select(['title', 'artists', 'year'])
  .where('year >= ?', [1980])
  .where('year <= ?', [1989])
  .orderBy('year', 'DESC')
  .limit(50)
  .build();

const releases = db.prepare(query.sql).all(...query.params);
```

**Indexes** for common queries:
- `idx_releases_year` - Year range queries
- `idx_releases_genres` - Genre filtering
- `idx_tracks_releaseId` - Track lookups

### 3. Concurrent Processing

**ConcurrencyManager** for parallel operations:

```typescript
const concurrency = new ConcurrencyManager({ maxConcurrent: 5 });

const results = await concurrency.runAll(
  releases.map(release => async () => {
    return await searchTrack(release);
  })
);
```

### 4. Batch Processing

**PlaylistBatchManager** for efficient API calls:

```typescript
const batchManager = new PlaylistBatchManager(soundcloudClient);

// Chunks tracks into batches, adds with rate limiting
await batchManager.addTracksToPlaylist(playlistId, trackIds, {
  batchSize: 100,
  delayBetweenBatches: 1000
});
```

### 5. Streaming Pagination

**Avoid loading all data into memory**:

```typescript
// Bad: Loads all pages into memory
const allReleases = await getCollectionPaginated(username);

// Good: Process page by page
for (let page = 1; page <= totalPages; page++) {
  const pageData = await getCollection(username, page);
  await processPage(pageData.releases);
}
```

---

## Security Architecture

### 1. Token Encryption

**AES-256-GCM** for at-rest encryption:

```typescript
class EncryptionService {
  encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return { encrypted, iv, authTag };
  }

  decrypt(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8');
  }
}
```

### 2. OAuth 2.1 with PKCE

**Secure authentication flow**:

1. Generate code verifier and challenge
2. Redirect to authorization URL
3. User grants permission
4. Exchange code for tokens
5. Encrypt and store tokens
6. Auto-refresh before expiration

### 3. Input Validation

**Validator** sanitizes all user inputs:

```typescript
const validated = Validator.validateSyncOptions(options);
// Ensures: username is valid, force is boolean, etc.
```

### 4. Environment Variable Security

**Never commit secrets**:
- `.env` in `.gitignore`
- `.env.example` with placeholders
- `ENCRYPTION_KEY` must be 64-character hex
- Validation on startup

### 5. SQL Injection Prevention

**Prepared statements** for all queries:

```typescript
// Safe: Uses placeholders
const stmt = db.prepare('SELECT * FROM releases WHERE discogsId = ?');
stmt.get(userInput);

// Unsafe: String concatenation (NEVER DO THIS)
db.exec(`SELECT * FROM releases WHERE discogsId = ${userInput}`);
```

---

## Adding New Features

### Checklist for New Features

1. **Define Requirements**
   - What problem does it solve?
   - What are the inputs and outputs?
   - What are the error cases?

2. **Design Architecture**
   - Which layer does it belong to?
   - What are the dependencies?
   - How does data flow?

3. **Implement**
   - Create files in appropriate directories
   - Follow existing patterns
   - Use dependency injection
   - Handle errors appropriately

4. **Write Tests**
   - Unit tests for services
   - Integration tests for commands
   - Edge case tests
   - Error scenario tests

5. **Update Documentation**
   - Add to README.md
   - Update API_REFERENCE.md if needed
   - Add inline JSDoc comments

6. **Code Quality**
   - Run `npm run format`
   - Run `npm run lint`
   - Run `npm test`
   - Run `npm run build`

### Example: Adding Spotify Integration

**1. Create API Client** (`src/api/spotify.ts`):
```typescript
export class SpotifyAPIClient {
  constructor(accessToken: string) { /* ... */ }
  async searchTrack(query: string): Promise<SpotifyTrack[]> { /* ... */ }
  async createPlaylist(title: string): Promise<SpotifyPlaylist> { /* ... */ }
}
```

**2. Create Service** (`src/services/spotify-playlist.ts`):
```typescript
export class SpotifyPlaylistService {
  constructor(
    private spotifyClient: SpotifyAPIClient,
    private db: DatabaseManager
  ) {}

  async createPlaylistFromFilter(filter: PlaylistFilter): Promise<string> {
    const releases = await this.db.getReleasesByFilter(filter);
    const playlist = await this.spotifyClient.createPlaylist(filter.title);

    for (const release of releases) {
      const tracks = await this.spotifyClient.searchTrack(
        `${release.title} ${release.artists}`
      );
      await this.spotifyClient.addToPlaylist(playlist.id, tracks[0].id);
    }

    return playlist.url;
  }
}
```

**3. Create Command** (`src/commands/spotify-playlist.ts`):
```typescript
export function createSpotifyPlaylistCommand(
  spotifyClient: SpotifyAPIClient,
  db: DatabaseManager
) {
  const cmd = new Command('spotify-playlist')
    .description('Create Spotify playlist from Discogs collection')
    .option('-t, --title <title>', 'Playlist title');

  cmd.action(async (options) => {
    const spinner = CommandBuilder.createSpinner();
    try {
      const service = new SpotifyPlaylistService(spotifyClient, db);
      const url = await service.createPlaylistFromFilter({
        title: options.title,
        genres: options.genres?.split(',')
      });

      spinner.succeed(`Created playlist: ${url}`);
      process.exit(0);
    } catch (error) {
      spinner.fail(error.message);
      process.exit(1);
    }
  });

  return cmd;
}
```

**4. Register Command** (`src/index.ts`):
```typescript
const spotifyAccessToken = process.env.SPOTIFY_ACCESS_TOKEN;
const spotifyClient = new SpotifyAPIClient(spotifyAccessToken);

program.addCommand(
  createSpotifyPlaylistCommand(spotifyClient, db)
);
```

**5. Write Tests** (`tests/spotify.test.ts`):
```typescript
describe('SpotifyPlaylistService', () => {
  it('should create playlist from filter', async () => {
    const mockClient = createMockSpotifyClient();
    const mockDb = createMockDatabase();
    const service = new SpotifyPlaylistService(mockClient, mockDb);

    const url = await service.createPlaylistFromFilter({
      title: 'Test',
      genres: ['Rock']
    });

    expect(url).toBe('https://spotify.com/playlist/123');
  });
});
```

---

## Conclusion

Discogs Manager CLI is built with a **clean, layered architecture** that separates concerns, handles errors gracefully, and provides clear extension points. The system is designed to be:

- **Maintainable**: Clear structure and consistent patterns
- **Testable**: Dependency injection and mocking support
- **Extensible**: Well-defined extension points
- **Reliable**: Comprehensive error handling and recovery
- **Performant**: Caching, batching, and concurrent processing
- **Secure**: Encryption, validation, and secure authentication

Use this document as a guide when extending or modifying the system. Follow the established patterns and principles to maintain consistency and quality.

---

**Version**: 1.0.0
**Last Updated**: 2026-02-21
**Maintainers**: See CONTRIBUTING.md
