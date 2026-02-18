import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';

/**
 * Type for command handler function
 * Takes spinner and options, returns void or Promise<void>
 */
export type CommandHandler = (spinner: Ora, options: any) => Promise<void> | void;

/**
 * Options for creating a command
 */
export interface CommandOptions {
  name: string;
  description: string;
  handler: CommandHandler;
}

/**
 * Shared command builder to reduce duplication across all commands
 * Handles:
 * - Spinner initialization and management
 * - Unified error handling with process.exit()
 * - Consistent success/failure messaging
 * - Pre/post hooks for extensibility
 */
export class CommandBuilder {
  /**
   * Create a command with unified error handling and spinner management
   * 
   * @param options - Command configuration including name, description, and handler
   * @returns Commander Command instance
   * 
   * @example
   * const cmd = CommandBuilder.create({
   *   name: 'sync',
   *   description: 'Sync collection',
   *   handler: async (spinner, options) => {
   *     spinner.text = 'Syncing...';
   *     const result = await syncCollection();
   *     spinner.succeed(`Synced ${result.count} items`);
   *   }
   * });
   */
  static create(options: CommandOptions): Command {
    const { name, description, handler } = options;

    return new Command(name)
      .description(description)
      .action(async (cmdOptions) => {
        const spinner = this.createSpinner();

        try {
          // Run the command handler
          await handler(spinner, cmdOptions);

          // Only exit if handler didn't already exit
          // (some handlers call process.exit internally)
          process.exit(0);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          spinner.fail(chalk.red(`✗ ${errorMessage}`));
          process.exit(1);
        }
      });
  }

  /**
   * Create and start a new spinner
   * 
   * @returns Ora spinner instance
   */
  static createSpinner(): Ora {
    return ora().start();
  }

  /**
   * Utility to create a standard progress callback for spinners
   * 
   * @param spinner - Ora spinner instance
   * @returns Progress callback function
   */
  static createProgressCallback(spinner: Ora) {
    return (progress: any) => {
      let message = `${progress.stage}`;

      if (progress.total && progress.total > 0) {
        message += `: ${progress.current}/${progress.total}`;
      }

      if (progress.currentPage !== undefined && progress.totalPages !== undefined) {
        message += ` (page ${progress.currentPage}/${progress.totalPages})`;
      }

      if (progress.message) {
        message += ` - ${progress.message}`;
      }

      spinner.text = message;
    };
  }

  /**
   * Utility to format success message
   * 
   * @param message - Success message
   * @returns Formatted message
   */
  static formatSuccess(message: string): string {
    return chalk.green(`✓ ${message}`);
  }

  /**
   * Utility to format error message
   * 
   * @param message - Error message
   * @returns Formatted message
   */
  static formatError(message: string): string {
    return chalk.red(`✗ ${message}`);
  }

  /**
   * Utility to format warning message
   * 
   * @param message - Warning message
   * @returns Formatted message
   */
  static formatWarning(message: string): string {
    return chalk.yellow(`⚠ ${message}`);
  }
}
