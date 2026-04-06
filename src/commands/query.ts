import { Command } from 'commander';
import { DatabaseManager } from '../services/database';
import { parseQuery, QueryParseError } from '../services/query/parser';
import { validateAST, SchemaValidationError } from '../services/query/schema';
import { buildQuery } from '../services/query/builder';
import { executeQuery } from '../services/query/executor';
import { formatResult } from '../services/query/formatter';

export function createQueryCommand(db: DatabaseManager): Command {
  const cmd = new Command('query')
    .description('Query your collection using the collection query language')
    .argument('<query>', "Query string (e.g. \"releases where genre contains 'Jazz'\")")
    .option('--json', 'Output as JSON instead of tabular text')
    .option('--limit <n>', 'Override the maximum number of rows returned');

  cmd.action(async (queryStr: string, options) => {
    // Parse
    let ast;
    try {
      ast = parseQuery(queryStr);
    } catch (error) {
      if (error instanceof QueryParseError) {
        console.error(`Parse error: ${error.message}`);
        console.error(`  ${queryStr}`);
        console.error(`  ${' '.repeat(error.position)}^`);
        console.error(`  Expected: ${error.expected}`);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }

    // Apply CLI limit override
    if (options.limit !== undefined) {
      const lim = parseInt(options.limit, 10);
      if (!isNaN(lim) && lim > 0) ast.limit = lim;
    }

    // Validate
    try {
      validateAST(ast);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        console.error(`Query error: ${error.message}`);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
      }
      process.exit(1);
    }

    // Build + Execute + Format
    try {
      const built = buildQuery(ast);
      const result = await executeQuery(db, built);
      const output = formatResult(result, {
        json: !!options.json,
        isTTY: process.stdout.isTTY ?? false,
      });
      process.stdout.write(output + '\n');
    } catch (error) {
      console.error(`Execution error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    process.exit(0);
  });

  return cmd;
}
