/**
 * SoundCloud OAuth 2.1 with PKCE Authentication
 * Handles Authorization Code Flow for CLI applications
 * Stores tokens encrypted in database for persistence and auto-refresh
 */

import axios from 'axios';
import crypto from 'crypto';
import { Logger } from '../utils/logger';
import { ErrorHandler, ErrorType } from '../utils/error-handler';
import { EncryptionService } from '../utils/encryption';
import { DatabaseManager } from './database';

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  expires_at: number; // Unix timestamp
}

/**
 * Generates PKCE code challenge and verifier
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // Generate random code verifier (43-128 characters)
  const codeVerifier = crypto
    .randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Generate code challenge from verifier
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return { codeVerifier, codeChallenge };
}

/**
 * Generates random state for CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class SoundCloudOAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private db?: DatabaseManager;
  private encryption?: EncryptionService;
  private readonly REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string = 'http://localhost:8080/callback',
    db?: DatabaseManager,
    encryption?: EncryptionService,
  ) {
    if (!clientId || !clientSecret) {
      throw new Error('SoundCloud OAuth requires both clientId and clientSecret');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.db = db;
    this.encryption = encryption;
  }

  /**
   * Get authorization URL for user to visit
   */
  getAuthorizationUrl(): {
    url: string;
    codeVerifier: string;
    state: string;
  } {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
      scope: 'playlist-modify-public playlist-modify-private track:read',
    });

    const url = `https://secure.soundcloud.com/authorize?${params.toString()}`;

    return { url, codeVerifier, state };
  }

  /**
   * Exchange authorization code for access token and store encrypted in database
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string
  ): Promise<OAuthToken> {
    try {
      const response = await axios.post(
        'https://secure.soundcloud.com/oauth/token',
        {
          grant_type: 'authorization_code',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
          code_verifier: codeVerifier,
          code: code,
        },
        {
          headers: {
            'accept': 'application/json; charset=utf-8',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const tokenData = response.data as OAuthToken;
      // Add expires_at timestamp
      tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);

      // Store encrypted tokens if database and encryption available
      if (this.db && this.encryption) {
        await this.storeTokens(tokenData);
      }

      Logger.info('[SoundCloud] Successfully obtained access token');
      return tokenData;
    } catch (error: any) {
      Logger.error(`Failed to exchange code for token: ${error.message}`);
      if (error.response?.data) {
        Logger.error(`API Error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Refresh an expired access token and update encrypted storage
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    try {
      const response = await axios.post(
        'https://secure.soundcloud.com/oauth/token',
        {
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        },
        {
          headers: {
            'accept': 'application/json; charset=utf-8',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const tokenData = response.data as OAuthToken;
      // Add expires_at timestamp
      tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);

      // Update encrypted tokens if database and encryption available
      if (this.db && this.encryption) {
        await this.storeTokens(tokenData);
      }

      Logger.info('[SoundCloud] Successfully refreshed access token');
      return tokenData;
    } catch (error: any) {
      Logger.error(`Failed to refresh token: ${error.message}`);
      if (error.response?.data) {
        Logger.error(`API Error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Store tokens encrypted in database
   */
  private async storeTokens(token: OAuthToken): Promise<void> {
    if (!this.db || !this.encryption) return;

    try {
      const accessTokenData = this.encryption.encrypt(token.access_token);
      const refreshTokenData = this.encryption.encrypt(token.refresh_token);

      const db = (this.db as any).db;

      db.prepare(`
        INSERT OR REPLACE INTO soundcloud_tokens (
          id,
          access_token_encrypted,
          access_token_iv,
          access_token_auth_tag,
          refresh_token_encrypted,
          refresh_token_iv,
          refresh_token_auth_tag,
          expires_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1,
        accessTokenData.encrypted,
        accessTokenData.iv,
        accessTokenData.authTag,
        refreshTokenData.encrypted,
        refreshTokenData.iv,
        refreshTokenData.authTag,
        token.expires_at,
        new Date().toISOString(),
        new Date().toISOString(),
      );

      Logger.info('[SoundCloud] Tokens stored securely in database (encrypted)');
    } catch (error) {
      Logger.error(`Failed to store tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get valid access token from database, auto-refreshing if needed
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.db || !this.encryption) {
      throw new Error('Database and encryption not configured for token management');
    }

    try {
      const token = this.getStoredToken();

      if (!token) {
        throw new Error('No SoundCloud tokens found. Please run: npm run dev -- auth');
      }

      // Check if token needs refresh
      if (this.shouldRefreshToken(token)) {
        Logger.info('[SoundCloud] Access token expiring soon, refreshing...');
        
        // Decrypt refresh token
        const refreshTokenData = {
          encrypted: token.refresh_token_encrypted,
          iv: token.refresh_token_iv,
          authTag: token.refresh_token_auth_tag,
        };
        const refreshToken = this.encryption.decrypt(refreshTokenData);

        // Refresh the token
        await this.refreshToken(refreshToken);

        // Recursively get the new valid token
        return this.getValidAccessToken();
      }

      // Decrypt and return access token
      const accessTokenData = {
        encrypted: token.access_token_encrypted,
        iv: token.access_token_iv,
        authTag: token.access_token_auth_tag,
      };

      return this.encryption.decrypt(accessTokenData);
    } catch (error) {
      throw new Error(`Failed to get valid access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get stored token from database
   */
  private getStoredToken(): any {
    if (!this.db) return null;

    try {
      const db = (this.db as any).db;
      return db.prepare('SELECT * FROM soundcloud_tokens WHERE id = 1').get();
    } catch (error) {
      Logger.debug(`Error retrieving stored token: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Check if token should be refreshed (within threshold or expired)
   */
  private shouldRefreshToken(token: any): boolean {
    const now = Date.now();
    return now >= token.expires_at - this.REFRESH_THRESHOLD_MS;
  }

  /**
   * Clear stored tokens from database
   */
  async clearStoredTokens(): Promise<void> {
    if (!this.db) return;

    try {
      const db = (this.db as any).db;
      db.prepare('DELETE FROM soundcloud_tokens WHERE id = 1').run();
      Logger.info('[SoundCloud] Cleared stored tokens');
    } catch (error) {
      Logger.error(`Failed to clear tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: OAuthToken): boolean {
    // Check if within 5 minutes of expiration
    const expirationBuffer = 5 * 60 * 1000;
    return Date.now() + expirationBuffer > token.expires_at;
  }
}
