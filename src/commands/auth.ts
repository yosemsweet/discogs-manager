import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import express from 'express';
import { SoundCloudOAuthService } from '../services/soundcloud-oauth';
import { DatabaseManager } from '../services/database';
import { EncryptionService } from '../utils/encryption';
import * as fs from 'fs';
import * as path from 'path';
import { CommandBuilder } from '../utils/command-builder';
import { Logger } from '../utils/logger';

export function createAuthCommand() {
  const cmd = new Command('auth')
    .description('Authenticate with SoundCloud using OAuth 2.1')
    .action(async () => {
      const spinner = CommandBuilder.createSpinner();

      try {
        const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
        const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
        const encryptionKey = process.env.ENCRYPTION_KEY;

        if (!clientId || !clientSecret) {
          spinner.fail(CommandBuilder.formatError('SoundCloud OAuth credentials not found'));
          console.log(chalk.yellow('Add these to your .env file:'));
          console.log('  SOUNDCLOUD_CLIENT_ID=your_client_id');
          console.log('  SOUNDCLOUD_CLIENT_SECRET=your_client_secret');
          console.log('');
          console.log(chalk.gray('Get credentials at: https://soundcloud.com/you/apps'));
          process.exit(1);
        }

        if (!encryptionKey) {
          spinner.fail(CommandBuilder.formatError('ENCRYPTION_KEY not found'));
          console.log(chalk.yellow('Generate an encryption key with:'));
          console.log('  openssl rand -hex 32');
          console.log('');
          console.log(chalk.yellow('Then add to your .env file:'));
          console.log('  ENCRYPTION_KEY=<generated_key>');
          process.exit(1);
        }

        // Initialize encryption and database
        let encryption: EncryptionService;
        let db: DatabaseManager;

        try {
          encryption = new EncryptionService(encryptionKey);
          db = new DatabaseManager();
          await db.initialized;
        } catch (error) {
          spinner.fail(CommandBuilder.formatError(`Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`));
          process.exit(1);
        }

        spinner.text = 'Initializing SoundCloud OAuth flow...';
        const oauthService = new SoundCloudOAuthService(clientId, clientSecret, 'http://localhost:8080/callback', db, encryption);
        const { url, codeVerifier, state } = oauthService.getAuthorizationUrl();

        spinner.text = 'Opening browser for authorization...';

        // Start local server to receive callback
        const app = express();
        const server = app.listen(8080, () => {
          spinner.succeed(CommandBuilder.formatSuccess('Local server started on http://localhost:8080'));
          console.log('');
          console.log(chalk.cyan('📖 Opening browser for SoundCloud authorization...'));
        });

        let authComplete = false;

        app.get('/callback', async (req, res) => {
          const code = req.query.code as string;
          const returnedState = req.query.state as string;
          const error = req.query.error as string;

          // Handle authorization errors from SoundCloud
          if (error) {
            spinner.fail(CommandBuilder.formatError(`SoundCloud authorization denied: ${error}`));
            res.send(`
              <html>
                <body style="font-family: sans-serif; padding: 20px; text-align: center;">
                  <h1>❌ Authorization Denied</h1>
                  <p>You denied the authorization request.</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            setTimeout(() => {
              server.close();
              process.exit(1);
            }, 500);
            return;
          }

          // Validate state to prevent CSRF
          if (returnedState !== state) {
            spinner.fail(CommandBuilder.formatError('Security error: State mismatch'));
            res.status(403).send(
              '<h1>❌ Error</h1><p>Security validation failed. You can close this window.</p>'
            );
            setTimeout(() => {
              server.close();
              process.exit(1);
            }, 500);
            return;
          }

          if (!code) {
            spinner.fail(CommandBuilder.formatError('No authorization code received'));
            res.status(400).send(
              '<h1>❌ Error</h1><p>No authorization code received. Please try again. You can close this window.</p>'
            );
            setTimeout(() => {
              server.close();
              process.exit(1);
            }, 500);
            return;
          }

          try {
            spinner.start('Exchanging code for access token...');
            const token = await oauthService.exchangeCodeForToken(code, codeVerifier);

            // Tokens are automatically stored encrypted in database
            // (done by SoundCloudOAuthService.exchangeCodeForToken)

            spinner.succeed(CommandBuilder.formatSuccess('Authentication successful!'));
            console.log('');
            console.log(chalk.green('✓ Tokens securely stored in database (encrypted)'));
            console.log(chalk.gray(`   Token expires in: ${Math.floor(token.expires_in / 3600)} hours`));
            console.log('');
            console.log(chalk.cyan('You can now use the CLI to create playlists!'));

            res.send(`
              <html>
                <body style="font-family: sans-serif; padding: 20px; text-align: center;">
                  <h1>✅ Success!</h1>
                  <p>SoundCloud authentication completed successfully.</p>
                  <p>Tokens are securely stored in the database.</p>
                  <p>You can close this window and start using the CLI.</p>
                </body>
              </html>
            `);

            authComplete = true;
            // Close server immediately after successful auth
            setTimeout(() => {
              server.close();
              process.exit(0);
            }, 500);
          } catch (error) {
            spinner.fail(CommandBuilder.formatError('Failed to exchange code for token'));
            console.error('Error:', error instanceof Error ? error.message : String(error));

            res.status(500).send(`
              <html>
                <body style="font-family: sans-serif; padding: 20px; text-align: center;">
                  <h1>❌ Error</h1>
                  <p>Authentication failed: ${error instanceof Error ? error.message : String(error)}</p>
                  <p>You can close this window and try again.</p>
                </body>
              </html>
            `);
            setTimeout(() => {
              server.close();
              process.exit(1);
            }, 500);
          }
        });

        // Open browser
        await open(url);

        // Wait for completion with timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            spinner.warn(chalk.yellow('⚠️  Authentication timeout (10 minutes) - closing server'));
            server.close();
            resolve();
          }, 600000); // 10 minute timeout

          server.on('close', () => {
            clearTimeout(timeout);
            resolve();
          });

          server.on('error', (err: Error) => {
            spinner.fail(CommandBuilder.formatError(`Server error: ${err.message}`));
            clearTimeout(timeout);
            resolve();
          });
        });

        // If we get here and auth wasn't complete, exit with error
        if (!authComplete) {
          process.exit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spinner.fail(CommandBuilder.formatError(`Authentication error: ${message}`));
        process.exit(1);
      }
    });

  return cmd;
}
