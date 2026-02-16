# Discogs Manager CLI

A powerful command-line interface for managing your Discogs collection and creating SoundCloud playlists based on collection subsets.

## Features

- **Sync Collections**: Connect to your Discogs account and sync your entire collection locally
- **Organize by Genre**: Filter and view your collection organized by genre, year, and other criteria
- **Collection Statistics**: View comprehensive statistics about your collection
- **Create Playlists**: Automatically create SoundCloud playlists from filtered subsets of your collection
- **Local Database**: Fast, local SQLite database for caching your collection

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- Discogs API token (from [discogs.com/settings/developers](https://www.discogs.com/settings/developers))
- SoundCloud API credentials (optional, for playlist creation)

### Setup

1. Clone or navigate to the project directory
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

4. Edit `.env` with your credentials:

```env
DISCOGS_API_TOKEN=your_token_here
DISCOGS_USERNAME=your_username
SOUNDCLOUD_CLIENT_ID=your_client_id
SOUNDCLOUD_USER_TOKEN=your_user_token
DB_PATH=./data/discogs-manager.db
```

## Building

```bash
npm run build
```

## Usage

### Sync your Collection

Fetch all releases from your Discogs collection:

```bash
npm run dev sync --username your_discogs_username
```

### List Releases

View releases from your collection with optional filters:

```bash
# List all releases
npm run dev list

# Filter by genre
npm run dev list --genre "Rock"

# Filter by year
npm run dev list --year 2020

# Limit results
npm run dev list --limit 20
```

### View Statistics

Get an overview of your collection:

```bash
npm run dev stats
```

### Create SoundCloud Playlists

Create playlists from filtered collection subsets:

```bash
# Create playlist with specific genres
npm run dev playlist --title "Rock Collection" --genres "Rock,Alternative"

# Filter by year range
npm run dev playlist --title "80s Hits" --min-year 1980 --max-year 1989 --description "Classics from the 80s"

# Create private playlist
npm run dev playlist --title "Personal Mix" --genres "Jazz" --private
```

## Commands

### `sync`

Synchronize your Discogs collection to the local database.

**Options:**
- `-u, --username <username>` - Discogs username (overrides env)

### `list`

List releases from your collection with optional filters.

**Options:**
- `-g, --genre <genre>` - Filter by genre
- `-y, --year <year>` - Filter by year
- `--limit <limit>` - Limit number of results (default: 50)

### `stats`

Display collection statistics including total count, genres, and year range.

### `playlist`

Create a SoundCloud playlist from filtered collection subsets.

**Options:**
- `-t, --title <title>` - Playlist title (required)
- `-d, --description <description>` - Playlist description
- `-g, --genres <genres>` - Comma-separated genres to include
- `--min-year <year>` - Minimum year filter
- `--max-year <year>` - Maximum year filter
- `--private` - Create as private playlist

## Project Structure

```
src/
├── api/               # API client wrappers
│   ├── discogs.ts    # Discogs API client
│   └── soundcloud.ts # SoundCloud API client
├── commands/         # CLI command handlers
│   ├── sync.ts
│   ├── list.ts
│   ├── stats.ts
│   └── playlist.ts
├── services/         # Business logic
│   ├── collection.ts # Collection filtering and management
│   ├── playlist.ts   # Playlist creation logic
│   └── database.ts   # SQLite database manager
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── index.ts          # CLI entry point
```

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Linting & Formatting

```bash
# Run ESLint
npm run lint

# Format code with Prettier
npm run format
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## License

MIT
