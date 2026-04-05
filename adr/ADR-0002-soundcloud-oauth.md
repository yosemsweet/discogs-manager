# ADR-0002: SoundCloud OAuth 2.1 with PKCE and Encrypted Token Storage

**Date:** 2026-02-01  
**Status:** Accepted

## Context

SoundCloud requires OAuth for write API access (creating/updating playlists). The CLI runs on a user's machine, meaning there is no server to hold a client secret securely. Tokens stored in `.env` or plain SQLite would be exposed if the file is read.

## Decision

Use the **OAuth 2.1 Authorization Code flow with PKCE** (RFC 7636), which is designed for public clients (no server, no secret held server-side).

Flow:
1. CLI generates a `code_verifier` and `code_challenge` (SHA-256 of verifier)
2. Browser opens to SoundCloud's authorization endpoint with the challenge
3. User authorizes; browser redirects to `http://localhost:8080/callback` with an authorization code
4. CLI exchanges code + verifier for an access token and refresh token
5. Tokens are encrypted with AES-256-GCM and stored in the `soundcloud_tokens` SQLite table

**Token storage:** Encrypted with a user-supplied `ENCRYPTION_KEY` (64-char hex, stored in `.env`). Tokens are decrypted in memory only when needed. The `ENCRYPTION_KEY` itself is never stored in the database.

**Token refresh:** Access tokens auto-refresh 5 minutes before expiry using the stored refresh token. If refresh fails, the user is prompted to re-authenticate.

## Consequences

- No long-lived credentials in `.env` or plaintext files after initial auth
- PKCE prevents authorization code interception even on localhost
- Users must run `npm run dev -- soundcloud auth` once per machine
- `ENCRYPTION_KEY` must be kept in `.env`; losing it requires re-authentication
- `src/services/soundcloud-oauth.ts` handles the full PKCE flow; `src/commands/auth.ts` handles the CLI interaction and local callback server
