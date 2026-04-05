# SoundCloud OAuth System

**ADR:** [ADR-0002](../../../adr/ADR-0002-soundcloud-oauth.md)

Handles SoundCloud authentication using OAuth 2.1 with PKCE and stores tokens encrypted in SQLite.

---

## Setup

### Prerequisites

1. Go to [https://soundcloud.com/you/apps](https://soundcloud.com/you/apps) and create an app
2. Add to `.env`:
   ```env
   SOUNDCLOUD_CLIENT_ID=your_client_id
   SOUNDCLOUD_CLIENT_SECRET=your_client_secret
   SOUNDCLOUD_REDIRECT_URI=http://localhost:8080/callback
   ENCRYPTION_KEY=<64-char hex string>   # generate with: openssl rand -hex 32
   ```
3. Run `npm run dev -- soundcloud auth` — opens browser, handles callback, stores tokens

### Token Refresh

Tokens auto-refresh 5 minutes before expiry. If refresh fails (e.g., revoked), re-run `npm run dev -- soundcloud auth`.

---

## Flow

```
auth command
  → SoundCloudOAuthService.startAuthFlow()
      1. Generate code_verifier + code_challenge (PKCE)
      2. Open browser to SoundCloud authorization URL
      3. Local Express server listens on :8080 for callback
      4. Exchange authorization code + verifier for tokens
      5. Encrypt tokens with AES-256-GCM (ENCRYPTION_KEY)
      6. Store encrypted tokens in soundcloud_tokens table
```

---

## Key Files

| File | Responsibility |
|------|---------------|
| `src/services/soundcloud-oauth.ts` | PKCE flow, token exchange, refresh logic |
| `src/commands/auth.ts` | CLI interface, local callback server |
| `src/utils/encryption.ts` | AES-256-GCM encrypt/decrypt |
| `src/api/soundcloud.ts` | Attaches Bearer token to all API requests |

---

## Database

Table: `soundcloud_tokens` (single row, `id = 1`):
- `access_token_encrypted` — AES-256-GCM ciphertext
- `refresh_token_encrypted` — AES-256-GCM ciphertext
- `expires_at` — ISO timestamp for refresh scheduling

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Missing SoundCloud OAuth credentials" | No CLIENT_ID/SECRET in `.env` | Add credentials from soundcloud.com/you/apps |
| "Browser won't open" | Auto-open failed | Visit the printed URL manually |
| 401 on API calls | Token expired/revoked | Run `npm run dev -- soundcloud auth` again |
