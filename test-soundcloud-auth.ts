/**
 * Simple script to test SoundCloud API authentication
 */
import dotenv from 'dotenv';
import { SoundCloudAPIClient } from './src/api/soundcloud';

dotenv.config();

async function testAuthentication() {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const userToken = process.env.SOUNDCLOUD_USER_TOKEN;

  if (!clientId || !userToken) {
    console.error('❌ Missing SoundCloud credentials in .env');
    console.error(`   SOUNDCLOUD_CLIENT_ID: ${clientId ? '✓ set' : '✗ missing'}`);
    console.error(`   SOUNDCLOUD_USER_TOKEN: ${userToken ? '✓ set' : '✗ missing'}`);
    process.exit(1);
  }

  console.log('🔐 SoundCloud API Credentials Found');
  console.log(`   Client ID: ${clientId.substring(0, 10)}...`);
  console.log(`   User Token: ${userToken.substring(0, 10)}...`);
  console.log('');
  console.log('🧪 Testing SoundCloud API Authentication...');
  console.log('');

  const client = new SoundCloudAPIClient(clientId, userToken);

  try {
    // Try a simple search to verify auth works
    console.log('📝 Attempting test search (searching for "test")...');
    const result = await client.searchTrack('test', 1);

    if (result && result.length >= 0) {
      console.log('✅ Authentication Successful!');
      console.log('');
      console.log('📊 Test Search Results:');
      console.log(`   - Found ${result.length} track(s)`);
      if (result.length > 0) {
        console.log(`   - First result: "${result[0].title}" by ${result[0].user?.username || 'Unknown'}`);
      }
      console.log('');
      console.log('✨ SoundCloud API is ready for use!');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('');
    console.error('Full error details:');
    console.error('  Error:', error.message);
    console.error('  Status Code:', error.statusCode);
    console.error('  Original Error:', error.originalError?.message);
    
    if (error.statusCode === 401) {
      console.error('');
      console.error('❌ Authentication Failed: Invalid credentials');
      console.error('   The client ID or user token is invalid/expired');
      console.error('   Please verify your SoundCloud API credentials in .env');
    } else if (error.statusCode === 429) {
      console.error('');
      console.error('⚠️  Rate Limit Hit: You have exceeded SoundCloud API limits');
      console.error('   Message:', error.message);
      console.error('   This is expected behavior - the CLI will handle throttling automatically');
    } else {
      console.error('');
      console.error('❌ Authentication Error:', error.message);
      if (error.statusCode) {
        console.error(`   HTTP Status: ${error.statusCode}`);
      }
    }
    process.exit(1);
  }
}

testAuthentication();
