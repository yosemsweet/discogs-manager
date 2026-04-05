import { Command } from 'commander';
import { SoundCloudAPIClient } from '../api/soundcloud';
import { SoundCloudOAuthService } from '../services/soundcloud-oauth';
import { SoundCloudRateLimitService } from '../services/soundcloud-rate-limit';
import { DatabaseManager } from '../services/database';
import { EncryptionService } from '../utils/encryption';

export function createLookupCommand(
  soundcloudClient: SoundCloudAPIClient | null,
  db: DatabaseManager
) {
  const cmd = new Command('lookup')
    .description('Reverse lookup: find the Discogs track and playlists for a SoundCloud URL')
    .argument('<url>', 'SoundCloud track URL');

  cmd.action(async (url: string) => {
    let clientToUse = soundcloudClient;
    if (!clientToUse) {
      try {
        const rateLimitService = new SoundCloudRateLimitService(db);
        await rateLimitService.initializeFromDatabase();
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
        console.error(`SoundCloud authentication failed: ${msg}`);
        console.log('Please run: npm run dev -- auth');
        process.exit(1);
      }
    }

    // Resolve the URL via the SoundCloud /resolve API — never regex extraction
    let trackId: string;
    try {
      const resource = await clientToUse.resolveUrl(url);
      if (resource.kind !== 'track') {
        console.error(`URL resolves to a ${resource.kind}, not a track.`);
        process.exit(1);
      }
      trackId = String(resource.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        console.error(`Track not found on SoundCloud: ${msg}`);
      } else {
        console.error(`Could not resolve URL: ${msg}`);
      }
      process.exit(1);
    }

    const trackInfo = await db.getTrackLookupData(trackId);
    if (!trackInfo) {
      console.log('Track not found in local database');
      process.exit(0);
    }

    console.log(`\nDiscogs Track:   ${trackInfo.discogsTrackTitle}`);
    console.log(`Discogs Artist:  ${trackInfo.discogsArtist}`);
    console.log(`Discogs Release: ${trackInfo.discogsRelease}`);
    console.log(`Discogs URL:     https://www.discogs.com/release/${trackInfo.discogsReleaseId}`);
    console.log(`\nPlaylists:`);
    if (trackInfo.playlists.length === 0) {
      console.log('  Not in any playlists');
    } else {
      trackInfo.playlists.forEach(p => console.log(`  - ${p}`));
    }
    console.log();

    process.exit(0);
  });

  return cmd;
}
