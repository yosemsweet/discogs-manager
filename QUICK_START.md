# Quick Start Guide

Get up and running with Discogs Manager CLI in under 5 minutes.

---

## What You'll Need

- [Node.js 18+](https://nodejs.org/) installed
- A [Discogs account](https://www.discogs.com) (free)
- 5 minutes of your time

---

## Step 1: Install

Clone and install dependencies:

```bash
git clone https://github.com/yourusername/discogs-manager.git
cd discogs-manager
npm install
```

---

## Step 2: Get Your Discogs API Token

1. Go to [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
2. Click **"Generate new token"**
3. Copy the token (you'll need it in the next step)

---

## Step 3: Configure

Create your configuration file:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
DISCOGS_API_TOKEN=paste_your_token_here
DISCOGS_USERNAME=your_discogs_username

# Generate encryption key (required)
ENCRYPTION_KEY=run_this_command_below_and_paste_result_here
```

Generate your encryption key:

```bash
openssl rand -hex 32
```

Copy the output and paste it as your `ENCRYPTION_KEY` in `.env`.

**Your `.env` should look like this:**
```env
DISCOGS_API_TOKEN=AbCdEf123456789XyZ
DISCOGS_USERNAME=musiclover42
ENCRYPTION_KEY=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

---

## Step 4: Sync Your Collection

This downloads your entire Discogs collection to a local database:

```bash
npm run dev -- collection sync
```

**What to expect:**
- Takes 1-3 minutes for a typical collection (50-200 releases)
- Shows real-time progress
- Automatically handles API rate limits
- Stores everything locally in `data/discogs-manager.db`

**Example output:**
```
✔ Syncing releases [████████████████████] 100% | 127/127 releases
✔ Successfully synced 127 releases
```

---

## Step 5: Explore Your Collection

### View Statistics

```bash
npm run dev -- collection stats
```

**Example output:**
```
Collection Statistics for musiclover42
─────────────────────────────────────
Total Releases: 127
Total Genres: 15
Year Range: 1967 - 2024

Top Genres:
  • Rock: 45 releases
  • Electronic: 28 releases
  • Jazz: 18 releases
  • Hip Hop: 12 releases
  • Soul: 10 releases
```

### Browse Your Releases

```bash
npm run dev -- collection list
```

Shows a table of all your releases with titles, artists, years, and genres.

### Filter by Genre

```bash
npm run dev -- collection list --genres "Rock"
```

### Filter by Year Range

```bash
npm run dev -- collection list --min-year 1970 --max-year 1979
```

### Combine Filters

```bash
npm run dev -- collection list --genres "Jazz" --min-year 2000 --min-rating 4
```

---

## Common Workflows

### Workflow 1: Find Your 80s Rock Albums

```bash
npm run dev -- collection list --genres "Rock" --min-year 1980 --max-year 1989
```

### Workflow 2: See Your Highest Rated Releases

```bash
npm run dev -- collection list --min-rating 4
```

### Workflow 3: Update Your Collection

Run this periodically to add new releases you've added to Discogs:

```bash
npm run dev -- collection sync
```

It only syncs new releases (skips existing ones), so it's fast!

### Workflow 4: Force Refresh Everything

If you've updated ratings or metadata on Discogs:

```bash
npm run dev -- collection sync --force
```

This re-downloads all release data (slower but updates everything).

---

## Optional: SoundCloud Playlists

Want to create SoundCloud playlists from your collection? Follow these extra steps.

### 1. Create a SoundCloud App

1. Go to [soundcloud.com/you/apps](https://soundcloud.com/you/apps)
2. Click **"Register a new app"**
3. Fill in:
   - **App name**: "Discogs Manager"
   - **App website**: Your GitHub repo URL or any URL
4. Copy your **Client ID**

### 2. Add to .env

```env
SOUNDCLOUD_CLIENT_ID=paste_your_client_id_here
```

### 3. Authenticate

```bash
npm run dev -- soundcloud auth
```

This opens your browser to authorize the app. Click "Connect" and you're done!

### 4. Create a Playlist

```bash
npm run dev -- playlist create --title "80s Rock Classics" --genres "Rock" --min-year 1980 --max-year 1989
```

**What happens:**
1. Filters your collection by the criteria (Rock, 1980-1989)
2. Searches SoundCloud for each release
3. Creates a playlist with all found tracks
4. Returns the playlist URL

**Example output:**
```
✔ Created playlist: https://soundcloud.com/you/sets/80s-rock-classics
✔ Added 34 tracks from 42 releases
```

---

## Quick Reference

### Essential Commands

| Command | What It Does |
|---------|-------------|
| `npm run dev -- collection sync` | Download your Discogs collection |
| `npm run dev -- collection list` | View your releases |
| `npm run dev -- collection stats` | See collection statistics |
| `npm run dev -- collection query '<query>'` | Ad-hoc query with the query DSL |
| `npm run dev -- playlist create --title "My Playlist" --genres "Rock"` | Create SoundCloud playlist |
| `npm run dev -- soundcloud auth` | Authenticate with SoundCloud |

### Useful Filters

| Filter | Example | Description |
|--------|---------|-------------|
| `--genres "Rock,Jazz"` | Multiple genres | Comma-separated list |
| `--min-year 1970` | Year range start | Inclusive |
| `--max-year 1989` | Year range end | Inclusive |
| `--min-rating 4` | Minimum rating | 0-5 stars |
| `--styles "Funk,Soul"` | Musical styles | Comma-separated list |

### Examples

**Find 90s Hip Hop:**
```bash
npm run dev -- collection list --genres "Hip Hop" --min-year 1990 --max-year 1999
```

**Create Jazz Favorites Playlist:**
```bash
npm run dev -- playlist create --title "Jazz Favorites" --genres "Jazz" --min-rating 4
```

**View Detailed Statistics:**
```bash
npm run dev -- collection stats --verbose
```

**List Electronic Music:**
```bash
npm run dev -- collection list --genres "Electronic"
```

---

## Troubleshooting

### "Error: DISCOGS_API_TOKEN is required"

You didn't set up your `.env` file. Go back to **Step 3**.

### "Rate limit exceeded"

The CLI handles this automatically. You'll see:
```
⚠ Rate limit nearly exhausted. Pausing for 60 seconds...
```

Just wait—it will resume automatically.

### "No releases found"

You need to sync first:
```bash
npm run dev -- collection sync
```

### "Failed to fetch release"

Some releases may fail temporarily. They're automatically queued for retry:
```bash
npm run dev -- collection retry
```

### Database is locked

Wait for the current operation to finish. Only one operation can run at a time.

---

## What's Next?

Now that you're up and running:

1. **Explore Filters**: Try different genre and year combinations
2. **Create Playlists**: Set up SoundCloud integration if you haven't
3. **Automate**: Set up a weekly sync with cron/Task Scheduler
4. **Dive Deeper**: Read the full [README.md](README.md) for advanced features

### Advanced Features

- **Collection Query DSL**: Ad-hoc filtering, grouping, and aggregation — `collection query 'releases count(), genre group by genre order by count desc'`
- **Retry Queue**: Automatically retries failed releases
- **Dead Letter Queue**: Tracks permanently failed items
- **Custom Workflows**: Script multiple commands together
- **Direct Database Access**: Query SQLite directly for custom analysis
- **Structured Logging**: Configure detailed logging for debugging

See [README.md](README.md) for complete documentation.

---

## Architecture & Development

Want to extend or contribute?

- **[development-docs/systems/](development-docs/systems/)**: System-level documentation for each subsystem
- **[adr/](adr/)**: Architecture Decision Records
- **[PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md)**: Product features and benefits
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: Contribution guidelines
- **[API_REFERENCE.md](API_REFERENCE.md)**: API documentation for developers

---

## Support

**Having issues?**

1. Check [Troubleshooting](#troubleshooting) above
2. Review the full [README.md](README.md)
3. Search [GitHub Issues](https://github.com/yourusername/discogs-manager/issues)
4. Create a new issue with:
   - What you tried
   - What happened
   - Error messages
   - Your Node.js version (`node --version`)

---

## Summary

You've learned how to:

✅ Install and configure Discogs Manager CLI
✅ Sync your Discogs collection locally
✅ View statistics and browse your collection
✅ Filter releases by genre, year, and rating
✅ (Optional) Create SoundCloud playlists

**Most common workflow:**
```bash
# First time
npm run dev -- collection sync

# Browse and filter
npm run dev -- collection list --genres "Rock" --min-year 1970 --max-year 1979
npm run dev -- collection stats

# Update periodically
npm run dev -- collection sync
```

**Enjoy managing your music collection!** 🎵

---

**Version**: 2.0.0
**License**: MIT
**Full Documentation**: [README.md](README.md)
