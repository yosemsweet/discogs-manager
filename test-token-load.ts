import { DatabaseManager } from './src/services/database';
import { SoundCloudOAuthService } from './src/services/soundcloud-oauth';
import { EncryptionService } from './src/utils/encryption';

async function test() {
  const db = new DatabaseManager('./data/discogs-manager.db');
  const encryption = new EncryptionService();
  
  const oauthService = new SoundCloudOAuthService(
    process.env.SOUNDCLOUD_CLIENT_ID || '',
    process.env.SOUNDCLOUD_CLIENT_SECRET || '',
    'http://localhost:8080/callback',
    db,
    encryption
  );
  
  try {
    const token = await oauthService.getValidAccessToken();
    console.log('✓ Token loaded successfully:', token.substring(0, 20) + '...');
  } catch (error) {
    console.error('✗ Error loading token:', error instanceof Error ? error.message : error);
  }
}

test();
