import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import express from 'express';
import { SoundCloudOAuthService } from '../services/soundcloud-oauth';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export function createAuthCommand() {
  return new Command('auth')
    .description('Authenticate with SoundCloud using OAuth 2.1')
    .action(async () => {
      const spinner = ora().start();

      try {
        const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
        const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          spinner.fail(chalk.red('❌ SoundCloud OAuth credentials not found'));
          console.log(chalk.yellow('Add these to your .env file:'));
          console.log('  SOUNDCLOUD_CLIENT_ID=your_client_id');
          console.log('  SOUNDCLOUD_CLIENT_SECRET=your_client_secret');
          console.log('');
          console.log(chalk.gray('Get credentials at: https://soundcloud.com/you/apps'));
          process.exit(1);
        }

        spinner.text = 'Initializing SoundCloud OAuth flow...';
        const oauthService = new SoundCloudOAuthService(clientId, clientSecret);
        const { url, codeVerifier, state } = oauthService.getAuthorizationUrl();

        spinner.text = 'Opening browser for authorization...';

        // Start local server to receive callback
        const app = express();
        const server = app.listen(8080, () => {
          spinner.succeed(chalk.green('✅ Local server started on http://localhost:8080'));
          console.log('');
          console.log(chalk.cyan('📖 Opening browser for SoundCloud authorization...'));
        });

        let authComplete = false;
        let authError: Error | null = null;

        app.get('/callback', async (req, res) => {
          const code = req.query.code as string;
          const returnedState = req.query.state as string;
          const error = req.query.error as string;

          // Handle authorization errors from SoundCloud
          if (error) {
            spinner.fail(chalk.red(`❌ SoundCloud authorization denied: ${error}`));
            authError = new Error(`Authorization denied: ${error}`);
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
            authError = new Error('State mismatch - possible CSRF attack');
            spinner.fail(chalk.red('❌ Security error: State mismatch'));
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
            authError = new Error('No authorization code received');
            spinner.fail(chalk.red('❌ No authorization code received'));
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

            // Save token to .env file
            const envPath = path.resolve('.env');
            let envContent = fs.readFileSync(envPath, 'utf-8');

            // Update or add SOUNDCLOUD_ACCESS_TOKEN
            if (envContent.includes('SOUNDCLOUD_ACCESS_TOKEN=')) {
              envContent = envContent.replace(
                /SOUNDCLOUD_ACCESS_TOKEN=.*/,
                `SOUNDCLOUD_ACCESS_TOKEN=${token.access_token}`
              );
            } else {
              envContent += `\nSOUNDCLOUD_ACCESS_TOKEN=${token.access_token}`;
            }

            // Save refresh token for future use
            if (envContent.includes('SOUNDCLOUD_REFRESH_TOKEN=')) {
              envContent = envContent.replace(
                /SOUNDCLOUD_REFRESH_TOKEN=.*/,
                `SOUNDCLOUD_REFRESH_TOKEN=${token.refresh_token}`
              );
            } else {
              envContent += `\nSOUNDCLOUD_REFRESH_TOKEN=${token.refresh_token}`;
            }

            fs.writeFileSync(envPath, envContent);

            spinner.succeed(chalk.green('✅ Authentication successful!'));
            console.log('');
            console.log(chalk.green('Token saved to .env file'));
            console.log(chalk.gray(`   Token expires in: ${Math.floor(token.expires_in / 3600)} hours`));
            console.log('');
            console.log(chalk.cyan('You can now use the CLI to create playlists!'));

            res.send(`
              <html>
                <body style="font-family: sans-serif; padding: 20px; text-align: center;">
                  <h1>✅ Success!</h1>
                  <p>SoundCloud authentication completed successfully.</p>
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
            authError = error as Error;
            spinner.fail(chalk.red('❌ Failed to exchange code for token'));
            console.error('Error:', (error as Error).message);

            res.status(500).send(`
              <html>
                <body style="font-family: sans-serif; padding: 20px; text-align: center;">
                  <h1>❌ Error</h1>
                  <p>Authentication failed: ${(error as Error).message}</p>
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
            spinner.fail(chalk.red(`❌ Server error: ${err.message}`));
            clearTimeout(timeout);
            resolve();
          });
        });

        // If we get here and auth wasn't complete, exit with error
        if (!authComplete) {
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red(`❌ Authentication error: ${error}`));
        process.exit(1);
      }
    });
}
