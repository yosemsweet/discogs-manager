/**
 * Quick diagnostic script: checks what field format SoundCloud's API
 * returns for track IDs after the 2025 URN migration, and whether a
 * PUT /playlists/{id} with a numeric track ID is still accepted.
 *
 * Usage:
 *   npx ts-node scripts/test-soundcloud-api.ts
 */

import dotenv from 'dotenv';
import axios from 'axios';
import { DatabaseManager } from '../src/services/database';
import { EncryptionService } from '../src/utils/encryption';
import { SoundCloudOAuthService } from '../src/services/soundcloud-oauth';

dotenv.config();

async function main() {
  // --- 1. Get a valid access token ---
  let token: string;

  if (process.env.SOUNDCLOUD_ACCESS_TOKEN) {
    token = process.env.SOUNDCLOUD_ACCESS_TOKEN;
    console.log('Using SOUNDCLOUD_ACCESS_TOKEN from env\n');
  } else {
    const db = new DatabaseManager(process.env.DB_PATH || './data/discogs-manager.db');
    const enc = new EncryptionService(process.env.ENCRYPTION_KEY);
    const oauth = new SoundCloudOAuthService(
      process.env.SOUNDCLOUD_CLIENT_ID || '',
      process.env.SOUNDCLOUD_CLIENT_SECRET || '',
      'http://localhost:8080/callback',
      db,
      enc
    );
    token = await oauth.getValidAccessToken();
    console.log('Loaded token from database\n');
  }

  const client = axios.create({
    baseURL: 'https://api.soundcloud.com',
    headers: { Authorization: `OAuth ${token}` },
  });

  // --- 2. Verify auth: GET /me ---
  console.log('=== GET /me ===');
  try {
    const me = await client.get('/me');
    console.log(`Authenticated as: ${me.data.username} (id: ${me.data.id}, urn: ${me.data.urn ?? 'n/a'})\n`);
  } catch (e: any) {
    console.error('Auth failed:', e.response?.status, e.response?.data);
    process.exit(1);
  }

  // --- 3. Search for a track and inspect the id/urn fields ---
  console.log('=== GET /tracks?q=blue+note ===');
  try {
    const res = await client.get('/tracks', { params: { q: 'blue note', limit: 3 } });
    const tracks = Array.isArray(res.data) ? res.data : res.data?.collection ?? [];
    if (tracks.length === 0) {
      console.log('No search results returned.\n');
    } else {
      for (const t of tracks) {
        console.log({
          id: t.id,
          id_type: typeof t.id,
          urn: t.urn ?? '(no urn field)',
          title: t.title,
        });
      }
      console.log();
    }
  } catch (e: any) {
    console.error('Search failed:', e.response?.status, e.response?.data);
  }

  // --- 4. Fetch a known stored track by numeric ID to confirm it still resolves ---
  // Pull one ID from the DB
  const { execSync } = require('child_process');
  let storedId: string | null = null;
  try {
    storedId = execSync(
      `sqlite3 ${process.env.DB_PATH || './data/discogs-manager.db'} "SELECT soundcloudTrackId FROM playlist_releases LIMIT 1;"`
    ).toString().trim();
  } catch { /* no rows */ }

  if (storedId) {
    console.log(`=== GET /tracks/${storedId} (stored numeric ID) ===`);
    try {
      const res = await client.get(`/tracks/${storedId}`);
      const t = res.data;
      console.log({
        id: t.id,
        id_type: typeof t.id,
        urn: t.urn ?? '(no urn field)',
        title: t.title,
      });
      console.log('\n→ Numeric ID lookup still works.\n');
    } catch (e: any) {
      console.error(`GET /tracks/${storedId} failed:`, e.response?.status, e.response?.data);
      console.log('\n→ Numeric ID lookup is broken — URN may be required.\n');
    }
  }

  // --- 5. Quick PUT test: fetch your first playlist from the DB and attempt a no-op PUT ---
  let playlistId: string | null = null;
  try {
    playlistId = execSync(
      `sqlite3 ${process.env.DB_PATH || './data/discogs-manager.db'} "SELECT soundcloudId FROM playlists LIMIT 1;"`
    ).toString().trim();
  } catch { /* no rows */ }

  if (playlistId && storedId) {
    console.log(`=== PUT /playlists/${playlistId} with numeric track ID ${storedId} ===`);
    try {
      const res = await client.put(`/playlists/${playlistId}`, {
        playlist: { tracks: [{ id: storedId }] },
      });
      const returnedTracks = res.data?.tracks ?? [];
      console.log(`PUT succeeded. Playlist now has ${returnedTracks.length} track(s).`);
      if (returnedTracks.length > 0) {
        console.log('First returned track:', {
          id: returnedTracks[0].id,
          urn: returnedTracks[0].urn ?? '(no urn field)',
        });
      }
      console.log('\n→ Numeric track IDs in PUT are accepted.\n');
    } catch (e: any) {
      console.error('PUT failed:', e.response?.status, JSON.stringify(e.response?.data, null, 2));
      console.log('\n→ PUT with numeric ID rejected — URN format likely required.\n');
    }
  }

  // --- 6. POST /playlists with tracks in the body ---
  // Tests whether SoundCloud actually attaches tracks during initial creation.
  // Some APIs silently ignore items in the creation payload.
  if (storedId) {
    console.log(`=== POST /playlists with tracks: [{ id: ${storedId} }] ===`);
    try {
      const res = await client.post('/playlists', {
        playlist: {
          title: `[DIAGNOSTIC TEST - safe to delete] ${Date.now()}`,
          description: 'Temporary test playlist created by test-soundcloud-api.ts',
          sharing: 'private',
          tracks: [{ id: storedId }],
        },
      });
      const created = res.data;
      const trackCount = (created.tracks ?? []).length;
      console.log(`POST succeeded. New playlist id: ${created.id}`);
      console.log(`Track count in creation response: ${trackCount}`);
      if (trackCount > 0) {
        console.log('\n→ POST /playlists WITH tracks works — tracks are attached on creation.\n');
      } else {
        console.log('\n→ POST /playlists ignores the tracks field — tracks must be added via PUT after creation.\n');
      }

      // Clean up: delete the test playlist
      try {
        await client.delete(`/playlists/${created.id}`);
        console.log(`(Test playlist ${created.id} deleted.)\n`);
      } catch {
        console.log(`(Could not delete test playlist ${created.id} — delete it manually.)\n`);
      }
    } catch (e: any) {
      console.error('POST failed:', e.response?.status, JSON.stringify(e.response?.data, null, 2));
    }
  }
}

main().catch(console.error);
