# Discogs Manager CLI

A powerful command-line interface for managing your Discogs music collection and creating SoundCloud playlists based on curated collection subsets. Built with TypeScript and featuring robust error handling, automatic rate limiting, and local caching.

## Features

- **📦 Sync Collections**: Connect to your Discogs account and sync your entire collection locally with automatic pagination support
- **🔍 Advanced Filtering**: Filter releases by genre, year, style, and rating
- **📊 Collection Statistics**: View comprehensive statistics including total count, genre breakdown, and year range
- **🎵 Create Playlists**: Automatically create SoundCloud playlists from filtered collection subsets
- **💾 Local Database**: Fast SQLite database (better-sqlite3) for caching your collection
- **⚠️ Graceful Error Handling**: Automatic retry queues and dead letter queues for failed releases
- **🚦 Smart Rate Limiting**: Local throttling to stay within Discogs API limits (no 429 errors!)
- **📈 Progress Feedback**: Real-time progress updates for all long-running operations
- **🔄 Retry Queue**: Failed releases are queued for retry, with a DLQ for permanent failures
- **⚡ Performance**: Skip already-synced releases on subsequent runs (use --force for refresh)

## System Requirements

- **Node.js**: 18.0.0 or higher (tested on 25.6.1)
- **npm**: 9.0.0 or higher
- **Discogs Account**: Required (free at [discogs.com](https://www.discogs.com))
- **Discogs API Token**: Get one from [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
- **SoundCloud API Credentials** (Optional): Only needed for playlist creation features

## Quick Start

### 1. Installation

```bash
# Clone or navigate to the project
git clone https://github.com/yourusername/discogs-manager.git
cd discogs-manager

# Install dependencies
npm install
```

### 2. Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required
DISCOGS_API_TOKEN=your_token_from_https://www.discogs.com/settings/developers
DISCOGS_USERNAME=your_discogs_username

# Optional (for playlist creation)
SOUNDCLOUD_CLIENT_ID=your_soundcloud_client_id
SOUNDCLOUD_USER_TOKEN=your_soundcloud_user_token

# Optional (default: ./data/discogs-manager.db)
DB_PATH=./data/discogs-manager.db
```

### 3. Build

```bash
npm run build
```

### 4. Run Commands

```bash
# Sync your collection
npm run dev -- sync yosemsweet

# View your collection stats
npm run dev -- stats yosemsweet

# List releases
npm run dev -- list yosemsweet

# Create a playlist
npm run dev -- playlist yosemsweet --title "My Playlist" --genres "Rock"
```

## Commands

### `sync` - Synchronize Your Collection

Fetches all releases from your Discogs collection and stores them locally in SQLite.

**Syntax:**
```bash
npm run dev sync <username> [options]
```

**Options:**
- `<username>` - Discogs username to sync (required)
- `-f, --force` - Force refresh all releases from API (skip database cache)

**Examples:**
```bash
# Initial sync (fetches all releases)
npm run dev -- sync yosemsweet

# Sync again (skips existing releases, only fetches new ones)
npm run dev -- sync yosemsweet

# Force refresh all releases
npm run dev -- sync yosemsweet --force

# Use DISCOGS_USERNAME from .env
npm run dev -- sync
```

**What Happens:**
- Fetches paginated collection from Discogs (50 items per page)
- Skips releases already in the local database (unless `--force`)
- Stores release metadata: title, artists, year, genres, styles
- Queues failed releases for retry (see `retry` command)
- Logs progress with real-time updates
- Shows final summary with success/skip/failure counts

**Rate Limiting:**
- Automatically throttles requests when approaching API limit
- Pauses for 60 seconds if rate limit nearly exhausted
- Prevents 429 errors through proactive local throttling

---

### `list` - View Your Collection

Display releases from your collection with optional filtering.

**Syntax:**
```bash
npm run dev list <username> [options]
```

**Options:**
- `<username>` - Discogs username (required)
- `-g, --genres <genres>` - Filter by genres (comma-separated), e.g., "Rock,Jazz"
- `--min-year <year>` - Minimum release year (inclusive)
- `--max-year <year>` - Maximum release year (inclusive)
- `--min-rating <rating>` - Minimum rating (0-5)
- `--max-rating <rating>` - Maximum rating (0-5)
- `-s, --styles <styles>` - Filter by styles (comma-separated), e.g., "Funk,Soul"

**Examples:**
```bash
# List all releases (first 50)
npm run dev -- list yosemsweet

# List rock releases
npm run dev -- list yosemsweet --genres "Rock"

# List releases from 1970-1989
npm run dev -- list yosemsweet --min-year 1970 --max-year 1989

# List releases from 1980s with high ratings
npm run dev -- list yosemsweet --min-year 1980 --max-year 1989 --min-rating 4

# Combine multiple filters
npm run dev -- list yosemsweet --genres "Rock,Alternative" --min-year 2000

# View albums by style
npm run dev -- list yosemsweet --styles "Electronic,Ambient"
```

**Output Format:**
```
Title                        | Artists           | Year | Genres          | Rating
────────────────────────────────────────────────────────────────────────────────
Abbey Road                   | The Beatles       | 1969 | Rock, Pop       | 5
The Dark Side of the Moon    | Pink Floyd        | 1973 | Rock, Progressive| 5
```

---

### `stats` - Collection Statistics

Display comprehensive statistics about your collection.

**Syntax:**
```bash
npm run dev -- stats [username] [options]
```

**Options:**
- `[username]` - Discogs username (optional, uses env if not provided)
- `-v, --verbose` - Show detailed stats including style breakdown

**Examples:**
```bash
# Show collection statistics
npm run dev -- stats yosemsweet

# Show statistics with style breakdown
npm run dev -- stats yosemsweet --verbose
```

**Output:**
```
Collection Statistics for yosemsweet
─────────────────────────────────────
Total Releases: 42
Total Genres: 18
Year Range: 1969 - 2023

Top Genres:
  • Rock: 15 releases
  • Electronic: 8 releases
  • Jazz: 5 releases
  ...
```

**Output with --verbose:**
```
Collection Statistics for yosemsweet
─────────────────────────────────────
Total Releases: 42
Total Genres: 18
Year Range: 1969 - 2023

Top Genres:
  • Rock: 15 releases
  • Electronic: 8 releases
  • Jazz: 5 releases
  ...

Top Styles:
  • Alternative Rock: 7 releases
  • Synth-pop: 5 releases
  • Post-bop: 3 releases
  ...
```

---

### `retry` - Process Failed Releases

Process the retry queue and view the dead letter queue (DLQ) for permanently failed releases.

**Syntax:**
```bash
npm run dev retry <username>
```

**Examples:**
```bash
# Retry failed releases
npm run dev -- retry yosemsweet

# Check which releases are in the DLQ
npm run dev -- retry yosemsweet
```

**What Happens:**
- Fetches items from the retry queue (releases that failed during sync)
- Attempts to fetch each release again from Discogs
- Removes successful items from retry queue
- Moves items to DLQ after 3 failed attempts
- Displays DLQ records for debugging

**Retry Queue Status:**
- Max 3 retry attempts per release
- Automatically queued on transient errors (rate limit, network errors)
- 404 errors go directly to DLQ (resource doesn't exist)
- Reset with `--force-refresh` on sync to ignore queue

---

### `playlist` - Create SoundCloud Playlists

Create SoundCloud playlists from filtered subsets of your collection.

**Syntax:**
```bash
npm run dev playlist <username> [options]
```

**Options:**
- `<username>` - Discogs username (required)
- `-t, --title <title>` - Playlist title (required)
- `-d, --description <description>` - Playlist description
- `-g, --genres <genres>` - Filter by genres (comma-separated)
- `--min-year <year>` - Minimum release year
- `--max-year <year>` - Maximum release year
- `--min-rating <rating>` - Minimum rating (0-5)
- `--max-rating <rating>` - Maximum rating (0-5)
- `-s, --styles <styles>` - Filter by styles (comma-separated)

**Examples:**
```bash
# Create a Rock playlist
npm run dev -- playlist yosemsweet --title "Rock Classics" --genres "Rock"

# Create a 1980s playlist
npm run dev -- playlist yosemsweet --title "80s Hits" --min-year 1980 --max-year 1989 \
  --description "The best from the 1980s"

# Create a high-rated Jazz playlist
npm run dev -- playlist yosemsweet --title "Jazz Favorites" --genres "Jazz" --min-rating 4

# Complex filtering: Electronic music from 2000+ with high ratings
npm run dev -- playlist yosemsweet --title "Modern Electronic" --genres "Electronic" \
  --min-year 2000 --min-rating 3 --description "Contemporary electronic music"

# Create by style
npm run dev -- playlist yosemsweet --title "Funk & Soul" --styles "Funk,Soul"
```

---

## Error Handling & Recovery

### Retry Queue

When a release fails to sync (due to network errors, rate limits, etc.), it's automatically added to the retry queue:

```
[INFO] Queued release 12345 for retry
```

To retry failed releases later:

```bash
npm run dev -- retry yosemsweet
```

### Dead Letter Queue (DLQ)

Releases that fail permanently (404s or 3+ failed retries) are moved to the DLQ:

```
Dead Letter Queue contains 2 records:
  Release 99999: 404 Not Found (moved 2 hours ago)
  Release 88888: Rate limit exceeded after 3 retries
```

The DLQ helps identify permanently problematic releases for manual investigation.

---

## Rate Limiting

This CLI handles rate limits from both the Discogs and SoundCloud APIs automatically.

### Discogs API Rate Limiting

Discogs API limits requests using a **moving 60-second window**:

**How It Works:**
1. After each request, checks `X-Discogs-Ratelimit-Remaining` header
2. If remaining requests ≤ 2, pauses for 60 seconds
3. Window resets after 60 seconds of inactivity
4. Resumes automatically with full allowance

**You'll See:**
```
[WARN] Rate limit nearly exhausted: 1 remaining of 60. Pausing for 60 seconds...
[INFO] Resuming requests after rate limit pause.
```

### SoundCloud API Rate Limiting

SoundCloud limits requests to **15,000 plays per 24-hour rolling window**. The CLI handles this intelligently:

**How It Works:**
1. Tracks remaining requests after each API call
2. If remaining ≤ 5 requests, automatically pauses
3. Shows the reset time and waits until limit refreshes (24-hour window)
4. Resumes automatically with full allowance

**You'll See:**
```
[WARN] [SoundCloud] Approaching rate limit (4 requests remaining). 
       Pausing for 23h 58m 30s until reset at 2025-02-17T15:30:00.000Z
[INFO] [SoundCloud] Rate limit reset. Resuming requests with full allocation.
```

**Key Features:**
- Automatic throttling prevents 429 errors
- Rate limit state persists across CLI runs (stored in database)
- Works seamlessly with playlist creation
- No manual intervention required

No manual intervention needed—both CLIs stay within limits automatically!

---

## Database

The CLI uses **better-sqlite3** for fast, local caching:

- **Location:** `./data/discogs-manager.db` (configurable via `DB_PATH`)
- **Tables:**
  - `releases` - Cached release metadata
  - `playlists` - Created SoundCloud playlists
  - `playlist_releases` - Links between playlists and releases
  - `retry_queue` - Failed releases pending retry
  - `dlq` - Dead letter queue for permanent failures
  - `soundcloud_rate_limit` - SoundCloud rate limit state (remaining, reset_time)
- **WAL Mode:** Enabled for concurrent read/write access

### Viewing the Database

You can inspect the database directly:

```bash
# Using sqlite3 CLI
sqlite3 data/discogs-manager.db

# Query all releases
SELECT COUNT(*) as total_releases FROM releases;

# Check retry queue
SELECT * FROM retry_queue;

# Check DLQ
SELECT * FROM dlq;
```

---

## Performance Tips

1. **First Sync**: Initial sync takes longer as it fetches all releases from Discogs
   - For a 50-release collection: ~30-60 seconds
   - For a 200-release collection: ~2-3 minutes
   - Rate limiting pauses are included

2. **Subsequent Syncs**: Much faster as existing releases are skipped
   ```bash
   npm run dev -- sync yosemsweet  # Skips cached releases, only fetches new ones
   ```

3. **Force Refresh**: Use `--force` only when needed to refresh all data
   ```bash
   npm run dev -- sync yosemsweet --force  # Slower but updates all metadata
   ```

4. **Batch Operations**: Combine filtering to reduce API calls
   - Use genre + year filters before creating playlists
   - Reduces unnecessary Discogs requests

---

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
npm test

# Run tests matching a pattern
npm test collection

# Run with coverage
npm test -- --coverage
```

**Current Status:** 93 tests passing ✅

---

## Development

### Project Structure

```
discogs-manager/
├── src/
│   ├── api/
│   │   ├── discogs.ts           # Discogs API client with rate limiting & throttling
│   │   └── soundcloud.ts        # SoundCloud API client
│   ├── commands/
│   │   ├── sync.ts              # Sync command handler
│   │   ├── list.ts              # List command handler
│   │   ├── stats.ts             # Stats command handler
│   │   ├── playlist.ts          # Playlist command handler
│   │   └── retry.ts             # Retry queue processor
│   ├── services/
│   │   ├── collection.ts        # Collection business logic & filtering
│   │   ├── database.ts          # SQLite database manager
│   │   └── playlist.ts          # Playlist creation logic
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── utils/
│   │   ├── logger.ts            # Logging utility
│   │   ├── progress.ts          # Progress tracking & callbacks
│   │   ├── formatters.ts        # Output formatting
│   │   └── retry.ts             # Retry utilities
│   └── index.ts                 # CLI entry point
├── tests/
│   ├── api.test.ts              # API client tests
│   ├── collection.test.ts       # Collection service tests
│   ├── database.test.ts         # Database tests
│   ├── commands.test.ts         # Command handler tests
│   ├── error-handling.test.ts   # Error & edge case tests
│   └── integration.test.ts      # End-to-end tests
├── data/                        # SQLite database
├── .env.example                 # Environment template
├── .github/
│   └── copilot-instructions.md  # Development guidelines
├── tsconfig.json                # TypeScript config
├── jest.config.js               # Jest config
├── package.json                 # Dependencies
└── README.md                    # This file
```

### Building

```bash
npm run build       # Compile TypeScript to dist/
npm run dev         # Run with ts-node (for development)
npm run start       # Run compiled JavaScript
```

### Code Quality

```bash
npm run lint        # Run ESLint
npm run format      # Format with Prettier
npm run build       # Compile & check for errors
npm test            # Run test suite
```

---

## Troubleshooting

### "Rate limit exceeded" Errors
- **Discogs API:** The CLI now handles this automatically! If you see rate limit logs, it's pausing and resuming correctly.
- **SoundCloud API:** Limited to 15,000 requests per 24 hours. The CLI automatically throttles when approaching the limit.
  - **If Limit Exceeded:** Wait 24 hours from the reset time shown in the error message, or check the database for the stored reset time
  - **See Current State:** The rate limit state is stored in the database (`soundcloud_rate_limit` table)
- **Solution:** The CLI handles throttling automatically
- **Manual Check:** Reduce frequency of API calls or use `--force` less often

### "Failed to fetch release" Warnings
- **Cause:** Individual release fetch failed (404, network issue, etc.)
- **Solution:** These are automatically queued for retry. Run `npm run dev -- retry <username>` later
- **Manual Check:** Check the DLQ with `npm run dev -- retry <username>`

### "Invalid credentials"
- **Cause:** Invalid token or username in `.env`
- **Solution:** 
  1. Verify token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
  2. Check username is correct
  3. Restart the application after updating `.env`

### Database Locked
- **Cause:** Multiple concurrent operations on the database
- **Solution:** Better-sqlite3 handles locking automatically. If you see this, wait for current operation to complete.

### Empty Collection Results
- **Cause:** Collection not synced yet
- **Solution:** Run `npm run dev -- sync <username>` first

---

## Contributing

Contributions are welcome! Please:

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes and add tests
3. Run tests: `npm test`
4. Commit: `git commit -am 'Add your feature'`
5. Push: `git push origin feature/your-feature`
6. Create a Pull Request

---

## License

MIT - See LICENSE file for details

---

## Support

For issues, questions, or suggestions:

1. Check [Troubleshooting](#troubleshooting) section above
2. Review existing GitHub issues
3. Create a new issue with:
   - What you were trying to do
   - What went wrong
   - Relevant error messages
   - Your environment (Node version, OS)

---

## Acknowledgments

- [Discogs API](https://www.discogs.com/developers) - Music database API
- [SoundCloud API](https://soundcloud.com/api) - Playlist creation
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite3 binding
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [axios](https://github.com/axios/axios) - HTTP client
