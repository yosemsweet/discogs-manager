# SoundCloud OAuth 2.1 Setup Guide

The Discogs Manager CLI now uses **OAuth 2.1 with PKCE** for secure SoundCloud authentication. This replaces the old token-based approach.

## Why OAuth 2.1?

- **More Secure**: Uses authorization codes and PKCE for protection against attacks
- **User Consent**: Users explicitly authorize the app to access their account
- **Better Token Management**: Includes automatic token refresh
- **Industry Standard**: Follows SoundCloud's current security requirements

## Setup Instructions

### Step 1: Get SoundCloud Credentials

1. Go to [https://soundcloud.com/you/apps](https://soundcloud.com/you/apps)
2. Create a new app or select an existing one
3. You'll need two credentials:
   - **Client ID** - for public API access
   - **Client Secret** - for token exchange (KEEP THIS SECRET!)

### Step 2: Update .env File

Add your credentials to `.env`:

```env
SOUNDCLOUD_CLIENT_ID=your_client_id_here
SOUNDCLOUD_CLIENT_SECRET=your_client_secret_here
```

### Step 3: Authenticate

Run the authentication command:

```bash
npm run dev -- auth
```

This will:
1. ✅ Start a local server on http://localhost:8080
2. ✅ Open your browser to SoundCloud's authorization page
3. ✅ Ask you to authorize the app
4. ✅ Automatically receive the authorization code
5. ✅ Exchange the code for an access token
6. ✅ Save the token to your `.env` file
7. ✅ Close and clean up automatically

### Step 4: Use the CLI

Once authenticated, you can create playlists:

```bash
npm run dev -- playlist --title "My Jazz Collection" --genres "Jazz"
```

## How It Works

### OAuth 2.1 Authorization Code Flow with PKCE

1. **Client Creates Challenge**: 
   - Generates random `code_verifier` (43-128 chars)
   - Creates `code_challenge` from verifier using SHA256

2. **User Authorization**:
   - Browser opens SoundCloud authorize endpoint
   - User sees permission request
   - User clicks "Authorize"
   - Browser redirects with authorization `code`

3. **Token Exchange**:
   - CLI exchanges `code` + `code_verifier` for access token
   - SoundCloud validates and returns token
   - Token saved to `.env` for future use

4. **API Calls**:
   - All API requests include: `Authorization: OAuth {access_token}`

## Token Refresh

Tokens expire after approximately 1 hour. The CLI automatically stores the refresh token for future sessions. If needed, tokens can be refreshed:

```bash
npm run dev -- auth  # Re-authenticate to refresh
```

## Troubleshooting

### "Missing SoundCloud OAuth credentials"

**Problem**: .env file doesn't have CLIENT_ID and CLIENT_SECRET
**Solution**: 
1. Go to https://soundcloud.com/you/apps
2. Create/select an app
3. Copy CLIENT_ID and CLIENT_SECRET
4. Add to .env

### "Browser won't open"

**Problem**: Browser doesn't automatically open
**Solution**:
1. Manually visit the URL printed in the terminal
2. Authorize the app
3. You'll be redirected to http://localhost:8080/callback with a code

### "Authentication timeout"

**Problem**: Process times out after 10 minutes
**Solution**:
1. Run the auth command again
2. Complete authorization quickly (less than 10 minutes)

### Still getting 401 errors

**Problem**: Access token is invalid or expired
**Solution**:
1. Run `npm run dev -- auth` again to get a fresh token
2. Make sure SOUNDCLOUD_CLIENT_SECRET is correct
3. Check that token is saved in .env as SOUNDCLOUD_ACCESS_TOKEN

## Security Notes

- **Never commit your CLIENT_SECRET to git** - keep it in .env (which should be in .gitignore)
- Access tokens in .env are credentials - treat them like passwords
- PKCE prevents authorization code interception attacks
- State parameter prevents CSRF attacks

## Architecture

The OAuth implementation includes:

- **SoundCloudOAuthService** (`src/services/soundcloud-oauth.ts`)
  - Generates PKCE challenges
  - Handles OAuth authorization URL creation
  - Exchanges codes for tokens
  - Handles token refresh

- **auth Command** (`src/commands/auth.ts`)
  - CLI interface for authentication
  - Starts local Express server
  - Handles OAuth callback
  - Saves tokens to .env

- **SoundCloudAPIClient** (`src/api/soundcloud.ts`)
  - Uses OAuth tokens for API requests
  - Handles rate limiting
  - Error handling with proper authentication checks

## References

- [SoundCloud API Docs](https://developers.soundcloud.com/docs/api/guide#authentication)
- [OAuth 2.1 Standard](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-05)
- [PKCE (RFC 7636)](https://www.rfc-editor.org/rfc/rfc7636.html)
