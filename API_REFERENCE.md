# API Reference

## Table of Contents

- [DiscogsAPIClient](#discogapiclient)
- [SoundCloudAPIClient](#soundcloudapiclient)
- [CollectionService](#collectionservice)
- [PlaylistService](#playlistservice)
- [DatabaseManager](#databasemanager)
- [Types](#types)

---

## DiscogsAPIClient

Wrapper for the Discogs API with automatic rate limiting and error handling.

### Constructor

```typescript
constructor(token: string, username: string)
```

**Parameters:**
- `token` - Your Discogs API token
- `username` - Discogs username

**Throws:**
- `Error` if token or username is missing

### Methods

#### `getCollection(username?, page?)`

Fetch a single page of releases from a Discogs collection.

```typescript
async getCollection(
  username: string = this.username,
  page: number = 1
): Promise<any>
```

**Parameters:**
- `username` (optional) - Discogs username (defaults to constructor username)
- `page` (optional) - Page number (1-indexed, default: 1)

**Returns:** Collection page with releases array and pagination info

**Throws:** `DiscogsAPIClientError` on failure

**Example:**
```typescript
const client = new DiscogsAPIClient(token, username);
const page1 = await client.getCollection('yosemsweet', 1);
console.log(page1.releases.length); // Number of releases on page 1
```

#### `getCollectionPaginated(username?)`

Fetch all releases from a collection, automatically handling pagination.

```typescript
async getCollectionPaginated(
  username: string = this.username
): Promise<{ releases: any[]; pagination: { pages: number; items: number } }>
```

**Parameters:**
- `username` (optional) - Discogs username

**Returns:** All releases and pagination metadata

**Throws:** `DiscogsAPIClientError` on failure

**Example:**
```typescript
const allReleases = await client.getCollectionPaginated('yosemsweet');
console.log(`Total releases: ${allReleases.releases.length}`);
```

#### `getRelease(releaseId)`

Fetch detailed information for a specific release.

```typescript
async getRelease(releaseId: number): Promise<any>
```

**Parameters:**
- `releaseId` - Discogs release ID

**Returns:** Release details including title, artists, year, genres, styles

**Throws:**
- `DiscogsAPIClientError` with status 404 if release doesn't exist
- `DiscogsAPIClientError` with status 429 if rate limited

**Example:**
```typescript
const release = await client.getRelease(123456);
console.log(`${release.title} by ${release.artists.map(a => a.name).join(', ')}`);
```

#### `searchRelease(query, limit?)`

Search for releases by title, artist, or other criteria.

```typescript
async searchRelease(
  query: string,
  limit: number = 10
): Promise<any>
```

**Parameters:**
- `query` - Search query string
- `limit` (optional) - Max results (1-100, default: 10)

**Returns:** Search results with matching releases

**Throws:** `DiscogsAPIClientError` on failure

**Example:**
```typescript
const results = await client.searchRelease('Pink Floyd Dark Side', 5);
console.log(results.results.length); // Number of matching releases
```

---

## SoundCloudAPIClient

Wrapper for the SoundCloud API for playlist management.

### Constructor

```typescript
constructor(clientId: string, userToken: string)
```

**Parameters:**
- `clientId` - SoundCloud OAuth client ID
- `userToken` - SoundCloud user OAuth token

---

## CollectionService

Business logic for managing Discogs collections.

### Constructor

```typescript
constructor(discogsClient: DiscogsAPIClient, db: DatabaseManager)
```

### Methods

#### `syncCollection(username, onProgress?, forceRefresh?)`

Sync a Discogs collection to the local database.

```typescript
async syncCollection(
  username: string,
  onProgress: ProgressCallback = noopProgress,
  forceRefresh: boolean = false
): Promise<{ successCount: number; failureCount: number }>
```

**Parameters:**
- `username` - Discogs username to sync
- `onProgress` (optional) - Progress callback function
- `forceRefresh` (optional) - If true, refresh all releases; if false, skip existing

**Returns:** Object with success and failure counts

**Progress Callback:**
```typescript
interface ProgressInfo {
  stage: string;                 // e.g., "Syncing releases"
  current: number;               // Current count
  total: number;                 // Total count
  currentPage?: number;          // Current page number
  totalPages?: number;           // Total pages
  message?: string;              // Optional status message
}

type ProgressCallback = (info: ProgressInfo) => void;
```

**Example:**
```typescript
const result = await service.syncCollection('yosemsweet', (progress) => {
  console.log(`${progress.current}/${progress.total}: ${progress.message}`);
});
console.log(`Synced: ${result.successCount}, Failed: ${result.failureCount}`);
```

#### `filterReleases(filter, onProgress?)`

Filter releases based on criteria.

```typescript
async filterReleases(
  filter: PlaylistFilter,
  onProgress: ProgressCallback = noopProgress
): Promise<StoredRelease[]>
```

**Parameters:**
- `filter` - Filter criteria
- `onProgress` (optional) - Progress callback

**Filter Options:**
```typescript
interface PlaylistFilter {
  genres?: string[];      // Genre names to include
  minYear?: number;       // Minimum release year
  maxYear?: number;       // Maximum release year
  minRating?: number;     // Minimum rating (0-5)
  maxRating?: number;     // Maximum rating (0-5)
  styles?: string[];      // Style names to include
}
```

**Returns:** Array of matching releases

**Example:**
```typescript
const filter: PlaylistFilter = {
  genres: ['Rock', 'Alternative'],
  minYear: 1980,
  maxYear: 1989
};
const releases = await service.filterReleases(filter);
console.log(`Found ${releases.length} releases matching filter`);
```

#### `getGenres()`

Get list of all unique genres in the collection.

```typescript
async getGenres(): Promise<string[]>
```

**Returns:** Sorted array of genre names

**Example:**
```typescript
const genres = await service.getGenres();
console.log(`Available genres: ${genres.join(', ')}`);
```

#### `getStats()`

Get collection statistics.

```typescript
async getStats(): Promise<{
  totalReleases: number;
  totalGenres: number;
  yearsSpan: { min: number; max: number };
  genres: string[];
}>
```

**Returns:** Statistics object

**Example:**
```typescript
const stats = await service.getStats();
console.log(`Total: ${stats.totalReleases} releases`);
console.log(`Year range: ${stats.yearsSpan.min} - ${stats.yearsSpan.max}`);
```

#### `processRetryQueue(username, onProgress?)`

Process the retry queue for failed releases.

```typescript
async processRetryQueue(
  username: string,
  onProgress: ProgressCallback = noopProgress
): Promise<{ successCount: number; failureCount: number }>
```

**Parameters:**
- `username` - Discogs username
- `onProgress` (optional) - Progress callback

**Returns:** Success/failure counts for retry attempts

**Example:**
```typescript
const result = await service.processRetryQueue('yosemsweet');
console.log(`Retried: ${result.successCount} succeeded, ${result.failureCount} failed`);
```

---

## PlaylistService

Business logic for creating and managing SoundCloud playlists.

### Constructor

```typescript
constructor(soundcloudClient: SoundCloudAPIClient, db: DatabaseManager)
```

### Methods

#### `createPlaylist(title, releases, description?, onProgress?)`

Create a SoundCloud playlist from a collection of releases.

```typescript
async createPlaylist(
  title: string,
  releases: StoredRelease[],
  description?: string,
  onProgress: ProgressCallback = noopProgress
): Promise<string> // Returns playlist ID
```

**Parameters:**
- `title` - Playlist name
- `releases` - Array of releases to add
- `description` (optional) - Playlist description
- `onProgress` (optional) - Progress callback

**Returns:** SoundCloud playlist ID

**Example:**
```typescript
const playlistId = await service.createPlaylist(
  'My Rock Collection',
  releases,
  'Best rock albums from my collection'
);
console.log(`Created playlist: ${playlistId}`);
```

---

## DatabaseManager

SQLite database operations with better-sqlite3.

### Constructor

```typescript
constructor(dbPath: string = './data/discogs-manager.db')
```

### Properties

```typescript
initialized: Promise<void>  // Awaitable initialization promise
```

### Methods

#### `addRelease(release)`

Add or update a release in the database.

```typescript
async addRelease(release: StoredRelease): Promise<void>
```

#### `getAllReleases()`

Fetch all releases from the database.

```typescript
async getAllReleases(): Promise<StoredRelease[]>
```

#### `getReleasesByGenre(genre)`

Fetch releases matching a genre.

```typescript
async getReleasesByGenre(genre: string): Promise<StoredRelease[]>
```

#### `getReleasesByYear(minYear, maxYear)`

Fetch releases within a year range.

```typescript
async getReleasesByYear(minYear: number, maxYear: number): Promise<StoredRelease[]>
```

#### `releaseExists(discogsId)`

Check if a release exists in the database.

```typescript
async releaseExists(discogsId: number): Promise<boolean>
```

#### Retry Queue Methods

```typescript
// Add failed release to retry queue
async addToRetryQueue(releaseId: number, username: string, error: string): Promise<void>

// Increment retry attempt count
async incrementRetryAttempt(releaseId: number, username: string, error: string): Promise<void>

// Get items in retry queue for a user
async getRetryQueueItems(username: string): Promise<Array<{ releaseId: number; attemptCount: number }>>

// Remove item from retry queue
async removeFromRetryQueue(releaseId: number, username: string): Promise<void>
```

#### Dead Letter Queue Methods

```typescript
// Move release to DLQ
async moveToDLQ(releaseId: number, username: string, errorMessage: string): Promise<void>

// Fetch DLQ records
async getDLQRecords(username?: string): Promise<Array<{ releaseId: number; errorMessage: string; createdAt: string }>>
```

#### `close()`

Close database connection.

```typescript
async close(): Promise<void>
```

---

## Types

### StoredRelease

```typescript
interface StoredRelease {
  discogsId: number;
  title: string;
  artists: string;           // Comma-separated artist names
  year: number;
  genres: string;            // Comma-separated genres
  styles: string;            // Comma-separated styles
  condition?: string;
  rating?: number;
  addedAt: Date;
}
```

### PlaylistFilter

```typescript
interface PlaylistFilter {
  genres?: string[];
  minYear?: number;
  maxYear?: number;
  minRating?: number;
  maxRating?: number;
  styles?: string[];
}
```

### ProgressInfo

```typescript
interface ProgressInfo {
  stage: string;
  current: number;
  total: number;
  currentPage?: number;
  totalPages?: number;
  message?: string;
}
```

### DiscogsRelease

```typescript
interface DiscogsRelease {
  id: number;
  title: string;
  artists: string[];
  year: number;
  genres: string[];
  styles: string[];
  uri: string;
  resource_url: string;
  thumb: string;
  condition?: string;
  rating?: number;
}
```

### RetryQueueRecord

```typescript
interface RetryQueueRecord {
  id?: number;
  releaseId: number;
  username: string;
  attemptCount: number;
  lastError: string;
  lastAttemptAt: Date;
  createdAt: Date;
}
```

### DLQRecord

```typescript
interface DLQRecord {
  id?: number;
  releaseId: number;
  username: string;
  errorMessage: string;
  lastAttemptAt: Date;
  createdAt: Date;
}
```

---

## Error Handling

### DiscogsAPIClientError

```typescript
class DiscogsAPIClientError extends Error {
  statusCode?: number;           // HTTP status code
  originalError?: any;           // Original error object
  rateLimitResetTime?: Date;     // When rate limit resets (if 429)
}
```

**Common Status Codes:**
- `401` - Invalid credentials
- `404` - Release not found
- `429` - Rate limited (auto-handled with throttling)
- `500+` - Server errors (retried with backoff)

---

## Rate Limiting

The DiscogsAPIClient automatically handles rate limiting:

1. **Monitoring**: Checks `X-Discogs-Ratelimit-Remaining` header after each request
2. **Throttling**: Pauses requests when remaining ≤ 2
3. **Recovery**: Waits 60 seconds for window to reset
4. **Logging**: Provides feedback on throttling events

No manual intervention needed!

---

## Example: Full Workflow

```typescript
import { DiscogsAPIClient } from './api/discogs';
import { DatabaseManager } from './services/database';
import { CollectionService } from './services/collection';

const client = new DiscogsAPIClient(process.env.DISCOGS_TOKEN!, 'yosemsweet');
const db = new DatabaseManager('./data/discogs-manager.db');
await db.initialized;

const service = new CollectionService(client, db);

// 1. Sync collection
const syncResult = await service.syncCollection('yosemsweet', (progress) => {
  console.log(`${progress.current}/${progress.total}: ${progress.message}`);
});
console.log(`Synced ${syncResult.successCount} releases`);

// 2. Get statistics
const stats = await service.getStats();
console.log(`Collection has ${stats.totalReleases} releases`);

// 3. Filter releases
const rockReleases = await service.filterReleases({
  genres: ['Rock'],
  minYear: 1970,
  maxYear: 1989
});
console.log(`Found ${rockReleases.length} rock releases from the 70s-80s`);

// 4. Retry failed releases
const retryResult = await service.processRetryQueue('yosemsweet');
console.log(`Retry processed: ${retryResult.successCount} succeeded`);

await db.close();
```
