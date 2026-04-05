import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { DatabaseManager } from '../services/database';

/**
 * Escape a single CSV field per RFC 4180.
 * Fields containing commas, double-quotes, or newlines are wrapped in double-quotes,
 * and any internal double-quotes are doubled.
 */
export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function buildCsvRow(fields: string[]): string {
  return fields.map(csvEscape).join(',');
}

/**
 * Generate a CSV string for a playlist's matched and unmatched tracks.
 * Throws if the playlist is not found in the local database.
 */
export async function generatePlaylistCsv(db: DatabaseManager, playlistTitle: string): Promise<string> {
  const playlist = await db.getPlaylistByTitle(playlistTitle);
  if (!playlist) {
    throw new Error(`Playlist "${playlistTitle}" not found in local database`);
  }

  const headers = [
    'discogs_artist',
    'discogs_release',
    'discogs_track',
    'soundcloud_track',
    'soundcloud_url',
    'confidence',
    'status',
  ];
  const rows: string[] = [buildCsvRow(headers)];

  const matchedTracks = await db.getPlaylistExportMatched(playlist.id);
  for (const track of matchedTracks) {
    const url = track.soundcloud_permalink_url || `https://soundcloud.com/tracks/${track.soundcloud_track_id}`;
    rows.push(buildCsvRow([
      track.discogs_artist,
      track.discogs_release,
      track.discogs_track,
      track.soundcloud_track,
      url,
      track.confidence.toFixed(2),
      'matched',
    ]));
  }

  const unmatchedTracks = await db.getPlaylistExportUnmatched(playlistTitle);
  for (const track of unmatchedTracks) {
    rows.push(buildCsvRow([
      track.discogs_artist,
      track.discogs_release,
      track.discogs_track,
      '',
      '',
      '',
      'unmatched',
    ]));
  }

  return rows.join('\n') + '\n';
}

export function createExportCommand(db: DatabaseManager) {
  const cmd = new Command('export')
    .description('Export playlist track matches to CSV')
    .requiredOption('-t, --title <title>', 'Playlist title to export')
    .option('-o, --out <filepath>', 'Output file path (default: stdout)');

  cmd.action(async (options) => {
    const playlistTitle: string = options.title;

    let csv: string;
    try {
      csv = await generatePlaylistCsv(db, playlistTitle);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(msg);
      process.exit(1);
    }

    if (options.out) {
      const outPath = path.resolve(options.out);
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) {
        console.error(`Error: Directory does not exist: ${dir}`);
        process.exit(1);
      }
      try {
        fs.writeFileSync(outPath, csv, 'utf8');
        console.log(`CSV written to ${outPath}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to write file: ${msg}`);
        process.exit(1);
      }
    } else {
      process.stdout.write(csv);
    }

    process.exit(0);
  });

  return cmd;
}
