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
 * Parse a simple CSV string into rows of key-value maps.
 * Handles RFC 4180 double-quote escaping. First row is treated as headers.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length === 0) return [];

  // Remove trailing empty line
  if (lines[lines.length - 1].trim() === '') lines.pop();

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let field = '';
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            field += line[i++];
          }
        }
        fields.push(field);
        if (line[i] === ',') i++;
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) {
          fields.push(line.slice(i));
          break;
        } else {
          fields.push(line.slice(i, end));
          i = end + 1;
        }
      }
    }
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseRow(line);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h.trim()] = (values[idx] || '').trim();
    });
    return record;
  });
}

/**
 * Generate a CSV string for a playlist's matched, excluded, and unmatched tracks.
 * The `include` column is pre-filled:
 *   - matched tracks in the SoundCloud playlist: `yes`
 *   - matched tracks in excluded_tracks: `no`
 *   - unmatched tracks: (blank)
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
    'include',
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
      'yes',
    ]));
  }

  const excludedTracks = await db.getExcludedTracks(playlistTitle);
  for (const track of excludedTracks) {
    // Look up release/artist info from a release query
    rows.push(buildCsvRow([
      '',
      '',
      track.discogsTrackTitle,
      '',
      `https://soundcloud.com/tracks/${track.soundcloudTrackId}`,
      track.confidence !== null ? track.confidence.toFixed(2) : '',
      'matched',
      'no',
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
      '',
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

/**
 * Parse a playlist CSV (exported via `playlist export`) and return the
 * SoundCloud URLs for rows where `include=yes` and `status=matched`.
 * Permalink URLs are returned as-is; callers are responsible for resolving
 * them to track IDs (DB lookup → API /resolve fallback).
 *
 * Throws if:
 * - required columns are missing
 * - more than 500 `include=yes` rows are found
 */
export function parseCsvForImport(
  content: string
): { includedUrls: string[]; excludedRows: Array<{ url: string; confidence: number }> } {
  const rows = parseCsv(content);

  if (rows.length === 0) {
    throw new Error('CSV is empty or has no data rows');
  }

  const requiredColumns = ['soundcloud_url', 'status', 'include'];
  for (const col of requiredColumns) {
    if (!(col in rows[0])) {
      throw new Error(`CSV is missing required column: "${col}"`);
    }
  }

  const includedUrls: string[] = [];
  const excludedRows: Array<{ url: string; confidence: number }> = [];

  for (const row of rows) {
    const include = row['include']?.toLowerCase();
    const status = row['status']?.toLowerCase();

    if (include === 'yes') {
      if (status !== 'matched') {
        // Silently skip — can't include unmatched tracks
        continue;
      }
      const url = row['soundcloud_url'] || '';
      if (!url) continue;
      includedUrls.push(url);
    } else if (include === 'no' && status === 'matched') {
      const url = row['soundcloud_url'] || '';
      if (!url) continue;
      const confidence = parseFloat(row['confidence'] || '0') || 0;
      excludedRows.push({ url, confidence });
    }
  }

  if (includedUrls.length > 500) {
    throw new Error(
      `CSV contains ${includedUrls.length} rows with include=yes, ` +
      `but SoundCloud limits playlists to 500 tracks. ` +
      `Please set include=no on at least ${includedUrls.length - 500} row(s).`
    );
  }

  return { includedUrls, excludedRows };
}

/**
 * Extract a SoundCloud track ID from a URL.
 * Handles:
 *   - https://soundcloud.com/tracks/12345  (fallback format written by export)
 *   - Permalink URLs: resolved via the API if needed (caller must handle)
 * Returns the ID string, or null if extraction fails.
 */
export function extractTrackIdFromUrl(url: string): string | null {
  if (!url) return null;
  // Fallback format: https://soundcloud.com/tracks/{id}
  const directMatch = url.match(/soundcloud\.com\/tracks\/(\d+)/);
  if (directMatch) return directMatch[1];
  return null;
}
