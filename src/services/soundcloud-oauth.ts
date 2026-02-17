/**
 * SoundCloud OAuth 2.1 with PKCE Authentication
 * Handles Authorization Code Flow for CLI applications
 */

import axios from 'axios';
import crypto from 'crypto';
import { Logger } from '../utils/logger';

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

  constructor(clientId: string, clientSecret: string, redirectUri: string = 'http://localhost:8080/callback') {
    if (!clientId || !clientSecret) {
      throw new Error('SoundCloud OAuth requires both clientId and clientSecret');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
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
   * Exchange authorization code for access token
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
   * Refresh an expired access token
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
   * Check if token is expired
   */
  isTokenExpired(token: OAuthToken): boolean {
    // Check if within 5 minutes of expiration
    const expirationBuffer = 5 * 60 * 1000;
    return Date.now() + expirationBuffer > token.expires_at;
  }
}
