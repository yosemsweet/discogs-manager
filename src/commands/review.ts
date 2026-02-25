import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudOAuthService } from '../services/soundcloud-oauth';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { DatabaseManager } from '../services/database';
import { PlaylistBatchManager } from '../services/playlist-batch';
import { EncryptionService } from '../utils/encryption';
import { Logger } from '../utils/logger';

interface NearMissCandidate {
  id: string;
  title: string;
  username?: string;
  duration?: number;
  confidence: number;
  breakdown?: {
    titleScore: number;
    artistScore: number;
    durationScore: number;
  };
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return '?:??';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function promptUser(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export function createReviewCommand(
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
) {
  const cmd = new Command('review')
    .description('Interactively resolve unmatched tracks from a previous playlist run')
    .requiredOption('-t, --title <title>', 'Playlist title to review unmatched tracks for');

  cmd.action(async (options) => {
    const playlistTitle: string = options.title;

    // Initialise rate limit service so 429 responses update the stored state
    const rateLimitService = new SoundCloudRateLimitService(db);
    await rateLimitService.initializeFromDatabase();

    // Lazy-load SoundCloud client if not provided
    let clientToUse = soundcloudClient;
    if (!clientToUse) {
      try {
        const encryptionService = new EncryptionService(process.env.ENCRYPTION_KEY);
        const oauthService = new SoundCloudOAuthService(
          process.env.SOUNDCLOUD_CLIENT_ID || '',
          process.env.SOUNDCLOUD_CLIENT_SECRET || '',
          'http://localhost:8080/callback',
          db,
          encryptionService
        );
        const token = await oauthService.getValidAccessToken();
        clientToUse = new SoundCloudAPIClient(token, rateLimitService);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`SoundCloud authentication failed: ${msg}`));
        console.log(chalk.yellow('Please run: npm run dev -- auth'));
        process.exit(1);
      }
    }

    // Look up the SoundCloud playlist ID from the database
    const storedPlaylist = await db.getPlaylistByTitle(playlistTitle);
    if (!storedPlaylist || !storedPlaylist.soundcloudId) {
      console.error(chalk.red(`No playlist found with title "${playlistTitle}".`));
      console.log(chalk.gray('Make sure you have created the playlist first.'));
      process.exit(1);
    }
    const soundcloudPlaylistId = storedPlaylist.soundcloudId;

    // Load pending unmatched tracks
    const pending = await db.getUnmatchedTracks(playlistTitle, 'pending');

    if (pending.length === 0) {
      console.log(chalk.green(`✓ No pending unmatched tracks for "${playlistTitle}".`));
      const counts = await db.countUnmatchedTracks(playlistTitle);
      if (counts.resolved > 0 || counts.skipped > 0) {
        console.log(chalk.gray(`  Resolved: ${counts.resolved}  Skipped: ${counts.skipped}`));
      }
      process.exit(0);
    }

    console.log(chalk.bold(`\nManual review: "${playlistTitle}"`));
    console.log(chalk.gray(`${pending.length} unmatched track(s) to review.\n`));
    console.log(chalk.gray('Options for each track: [1-3] select candidate | [u] custom URL/ID | [s] skip | [q] quit\n'));

    const batchManager = new PlaylistBatchManager(clientToUse);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let resolved = 0;
    let skipped = 0;
    let quit = false;

    for (const track of pending) {
      if (quit) break;

      // Display track info
      console.log(chalk.bold(`─── Track ${pending.indexOf(track) + 1}/${pending.length} ───────────────────────`));
      console.log(`  ${chalk.cyan('Title:')}    ${track.discogsTrackTitle}`);
      if (track.discogsArtist) console.log(`  ${chalk.cyan('Artist:')}   ${track.discogsArtist}`);
      if (track.discogsDuration) console.log(`  ${chalk.cyan('Duration:')} ${track.discogsDuration}`);
      if (track.releaseTitle) console.log(`  ${chalk.cyan('Release:')}  ${track.releaseTitle}`);
      console.log(`  ${chalk.gray(`Strategies tried: ${track.strategiesTriedCount}`)}`);

      // Parse and display near-miss candidates
      let candidates: NearMissCandidate[] = [];
      if (track.topCandidatesJson) {
        try {
          candidates = JSON.parse(track.topCandidatesJson);
        } catch {
          // Malformed JSON — treat as no candidates
        }
      }

      if (candidates.length > 0) {
        console.log(chalk.gray('\n  Near-miss candidates:'));
        candidates.forEach((c, idx) => {
          const conf = chalk.yellow(`${(c.confidence * 100).toFixed(0)}%`);
          const dur = formatDuration(c.duration);
          const user = c.username ? chalk.gray(` @${c.username}`) : '';
          console.log(`  [${idx + 1}] ${conf} ${c.title}${user} (${dur})`);
          if (c.breakdown) {
            const bd = c.breakdown;
            console.log(chalk.gray(`      title:${(bd.titleScore * 100).toFixed(0)}% artist:${(bd.artistScore * 100).toFixed(0)}% duration:${(bd.durationScore * 100).toFixed(0)}%`));
          }
        });
      } else {
        console.log(chalk.gray('\n  (No near-miss candidates found)'));
      }

      // Interactive prompt
      let answered = false;
      while (!answered) {
        const input = await promptUser(rl, '\n  Choice: ');

        if (input === 'q' || input === 'Q') {
          quit = true;
          answered = true;
          console.log(chalk.yellow('\nReview paused. Run again to continue from remaining tracks.'));
        } else if (input === 's' || input === 'S') {
          await db.skipUnmatchedTrack(track.id);
          skipped++;
          answered = true;
          console.log(chalk.gray('  → Skipped'));
        } else if (input === 'u' || input === 'U') {
          const customInput = await promptUser(rl, '  Enter SoundCloud track ID or URL: ');
          // Extract numeric ID from URL like https://soundcloud.com/.../... or plain ID
          const idMatch = customInput.match(/(\d+)/);
          if (!idMatch) {
            console.log(chalk.red('  Invalid ID/URL. Please try again.'));
            continue;
          }
          const trackId = idMatch[1];
          await _resolveTrack(db, batchManager, soundcloudPlaylistId, track.id, trackId, track.discogsReleaseId, track.discogsTrackTitle, String(soundcloudPlaylistId));
          resolved++;
          answered = true;
          console.log(chalk.green(`  → Resolved with track ID ${trackId}`));
        } else {
          const num = parseInt(input, 10);
          if (num >= 1 && num <= candidates.length) {
            const chosen = candidates[num - 1];
            await _resolveTrack(db, batchManager, soundcloudPlaylistId, track.id, chosen.id, track.discogsReleaseId, track.discogsTrackTitle, String(soundcloudPlaylistId));
            resolved++;
            answered = true;
            console.log(chalk.green(`  → Resolved: "${chosen.title}"`));
          } else {
            console.log(chalk.red(`  Invalid input. Enter 1-${candidates.length}, [u]rl, [s]kip, or [q]uit.`));
          }
        }
      }

      console.log();
    }

    rl.close();

    // Final summary
    const remaining = pending.length - resolved - skipped;
    console.log(chalk.bold('\n─── Review Summary ────────────────────────'));
    console.log(`  ${chalk.green(`✓ Resolved: ${resolved}`)}`);
    console.log(`  ${chalk.gray(`Skipped:   ${skipped}`)}`);
    if (remaining > 0) {
      console.log(`  ${chalk.yellow(`Pending:   ${remaining}`)}`);
      console.log(chalk.gray(`\n  Run this command again to continue reviewing.`));
    } else {
      console.log(chalk.green('\n  All tracks reviewed!'));
    }

    process.exit(0);
  });

  return cmd;
}

export function createUnmatchedCommand(db: DatabaseManager) {
  const cmd = new Command('unmatched')
    .description('List unmatched tracks from a previous playlist run')
    .requiredOption('-t, --title <title>', 'Playlist title')
    .option('--status <status>', 'Filter by status: pending | resolved | skipped', 'pending')
    .option('--json', 'Output as JSON');

  cmd.action(async (options) => {
    const status = options.status as 'pending' | 'resolved' | 'skipped';
    const tracks = await db.getUnmatchedTracks(options.title, status);
    const counts = await db.countUnmatchedTracks(options.title);

    if (options.json) {
      console.log(JSON.stringify({ counts, tracks }, null, 2));
      process.exit(0);
    }

    console.log(chalk.bold(`\nUnmatched tracks for "${options.title}" [${status}]`));
    console.log(chalk.gray(`Pending: ${counts.pending}  Resolved: ${counts.resolved}  Skipped: ${counts.skipped}\n`));

    if (tracks.length === 0) {
      console.log(chalk.gray('  None.'));
    } else {
      tracks.forEach((t, idx) => {
        console.log(`${idx + 1}. ${chalk.cyan(t.discogsTrackTitle)}`);
        if (t.discogsArtist) console.log(`   Artist: ${t.discogsArtist}`);
        if (t.releaseTitle) console.log(`   Release: ${t.releaseTitle}`);
        if (t.discogsDuration) console.log(`   Duration: ${t.discogsDuration}`);
        console.log(chalk.gray(`   Strategies tried: ${t.strategiesTriedCount}  Created: ${t.createdAt}`));
        if (t.topCandidatesJson) {
          try {
            const cands: NearMissCandidate[] = JSON.parse(t.topCandidatesJson);
            if (cands.length > 0) {
              console.log(chalk.gray(`   Top candidate: "${cands[0].title}" (${(cands[0].confidence * 100).toFixed(0)}%)`));
            }
          } catch { /* ignore */ }
        }
        console.log();
      });
    }

    process.exit(0);
  });

  return cmd;
}

async function _resolveTrack(
  db: DatabaseManager,
  batchManager: PlaylistBatchManager,
  soundcloudPlaylistId: string,
  unmatchedId: number,
  soundcloudTrackId: string,
  discogsReleaseId: number,
  discogsTrackTitle: string,
  playlistDbId: string
): Promise<void> {
  try {
    // Fetch existing playlist tracks from DB so the PUT doesn't wipe them.
    // SoundCloud PUT /playlists/{id} replaces the entire track list.
    const existingTracks = await db.getPlaylistTracks(playlistDbId);
    const existingTrackIds = existingTracks
      .map(t => t.soundcloudTrackId)
      .filter(id => id !== soundcloudTrackId); // skip if already present

    // Add to the SoundCloud playlist, preserving existing tracks
    await batchManager.addTracksInBatches(soundcloudPlaylistId, [...existingTrackIds, soundcloudTrackId]);

    // Save to track match cache so future runs don't need to search again
    await db.saveCachedTrackMatch(
      discogsReleaseId,
      discogsTrackTitle,
      soundcloudTrackId,
      1.0,  // manually resolved = full confidence
      discogsTrackTitle,
      undefined
    );

    // Save to playlist_releases
    await db.addReleaseToPlaylist(playlistDbId, discogsReleaseId, soundcloudTrackId);

    // Mark unmatched record as resolved
    await db.resolveUnmatchedTrack(unmatchedId, soundcloudTrackId);
  } catch (error) {
    Logger.warn(`Failed to resolve track ${discogsTrackTitle}: ${error}`);
    throw error;
  }
}
