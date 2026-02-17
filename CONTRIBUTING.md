# Contributing to Discogs Manager

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

Be respectful and constructive in all interactions with other contributors.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Git
- Basic TypeScript knowledge

### Setup Development Environment

1. **Fork and clone the repository**
```bash
git clone https://github.com/yourusername/discogs-manager.git
cd discogs-manager
```

2. **Install dependencies**
```bash
npm install
```

3. **Create a `.env` file for testing**
```bash
cp .env.example .env
# Add your Discogs API token and username
```

4. **Verify setup**
```bash
npm test    # Run tests
npm run build  # Compile TypeScript
```

## Development Workflow

### Creating a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

Use descriptive branch names:
- `feature/add-export-command` - new features
- `fix/rate-limit-bug` - bug fixes
- `docs/update-readme` - documentation
- `refactor/improve-error-handling` - refactoring
- `test/add-playlist-tests` - tests

### Making Changes

1. **Write your code** - Keep it clean and focused
2. **Follow the style** - Use Prettier and ESLint
3. **Add tests** - Cover new functionality
4. **Update docs** - Document new features in README

### Code Style

```bash
# Format code with Prettier
npm run format

# Check linting issues
npm run lint

# Fix linting issues automatically
npm run lint -- --fix
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test collection.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm run test:watch
```

**Guidelines:**
- Write tests for new features
- Update existing tests if behavior changes
- Aim for > 85% code coverage
- Test edge cases and error scenarios

### Building

```bash
# Compile TypeScript
npm run build

# Check for TypeScript errors
npm run build  # Will fail if there are errors
```

## Commit Guidelines

Write clear, descriptive commit messages:

```bash
git commit -m "feat: add export to CSV functionality"
git commit -m "fix: handle empty collection on sync"
git commit -m "docs: add playlist creation examples"
git commit -m "test: add tests for retry queue"
git commit -m "refactor: improve rate limit handling"
```

**Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `test:` - Tests
- `refactor:` - Code refactoring
- `perf:` - Performance improvement
- `chore:` - Maintenance

## Pull Request Process

1. **Push to your fork**
```bash
git push origin feature/your-feature-name
```

2. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Description of what changed and why
   - Reference to any related issues (#123)
   - Screenshots/examples if applicable

3. **PR Checklist:**
   - [ ] Code follows style guidelines (run `npm run format`)
   - [ ] Tests added/updated and passing (`npm test`)
   - [ ] TypeScript compiles without errors (`npm run build`)
   - [ ] Documentation updated if needed
   - [ ] Commit messages are clear and descriptive

4. **Review Process:**
   - Maintainers will review your PR
   - Address feedback and push updates
   - Once approved, your PR will be merged

## Architecture & Design Principles

### Layered Architecture

- **API Layer** (`src/api/`) - External service wrappers with error handling
- **Service Layer** (`src/services/`) - Business logic and data processing
- **Database Layer** (`src/services/database.ts`) - Data persistence
- **CLI Layer** (`src/commands/`) - User interface and command handlers
- **Utilities** (`src/utils/`) - Shared helpers

### Key Principles

1. **Error Handling** - Graceful degradation with retry queues
2. **Rate Limiting** - Local throttling to prevent API limits
3. **Progress Feedback** - User-friendly progress callbacks
4. **Type Safety** - Strong TypeScript types throughout
5. **Testability** - Dependency injection for easy testing

### Adding a New Command

1. **Create handler** in `src/commands/newcmd.ts`:
```typescript
import { Command } from 'commander';
import { DiscogsAPIClient } from '../api/discogs';
import { DatabaseManager } from '../services/database';

export function createNewCmdCommand(
  discogsClient: DiscogsAPIClient,
  db: DatabaseManager
) {
  return new Command('newcmd')
    .description('Command description')
    .option('-o, --option <value>', 'Option description')
    .action(async (options) => {
      const spinner = ora().start();
      try {
        // Implementation here
        spinner.succeed('Success!');
        process.exit(0);
      } catch (error) {
        spinner.fail(`Error: ${error}`);
        process.exit(1);
      }
    });
}
```

2. **Register in** `src/index.ts`:
```typescript
import { createNewCmdCommand } from './commands/newcmd';

// ...in main program setup...
program.addCommand(createNewCmdCommand(discogsClient, db));
```

3. **Add tests** in `tests/commands.test.ts`

4. **Update documentation** in README.md

### Adding a New Service

1. **Create service** in `src/services/newservice.ts`:
```typescript
export class NewService {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  async doSomething(): Promise<Result> {
    // Implementation with error handling
  }
}
```

2. **Add types** to `src/types/index.ts` if needed

3. **Add tests** in `tests/` with meaningful test names

4. **Document** the service's public API

## Working with the Database

The project uses **better-sqlite3** for SQLite operations.

### Adding a Database Table

1. **Update schema** in `src/services/database.ts`:
```typescript
CREATE TABLE IF NOT EXISTS new_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

2. **Add methods** to DatabaseManager:
```typescript
async addItem(name: string): Promise<void> {
  const stmt = this.db.prepare('INSERT INTO new_table (name) VALUES (?)');
  stmt.run(name);
}
```

3. **Test thoroughly** - database changes affect all operations

## Performance Considerations

- **Batch Operations** - Use transactions for multiple inserts
- **Indexing** - Add indexes for frequently queried columns
- **Pagination** - Handle large datasets with pagination
- **Caching** - Skip existing data when safe to do so
- **Rate Limiting** - Respect API limits to avoid throttling

## Documentation

### Code Comments

```typescript
// Use comments for "why", not "what"
// Bad: const result = arr.filter(x => x > 5); // Filter array
// Good: 
const relevantItems = allItems.filter(x => x.priority > THRESHOLD);
// Filter to only high-priority items for processing
```

### Function Documentation

```typescript
/**
 * Syncs the user's Discogs collection to the local database.
 * Skips releases already in the database unless forceRefresh is true.
 * 
 * @param username - Discogs username to sync
 * @param onProgress - Optional callback for progress updates
 * @param forceRefresh - If true, refresh all releases from API
 * @returns Object with successCount and failureCount
 * @throws DiscogsAPIClientError if API request fails
 */
async syncCollection(
  username: string,
  onProgress?: ProgressCallback,
  forceRefresh: boolean = false
): Promise<{ successCount: number; failureCount: number }>
```

## Reporting Issues

When reporting bugs, include:

1. **Description** - What's the issue?
2. **Steps to reproduce** - How to trigger the bug
3. **Expected behavior** - What should happen
4. **Actual behavior** - What actually happens
5. **Environment** - Node version, OS, Discogs collection size
6. **Error logs** - Full error messages with stack traces

## Questions?

- Check existing documentation in README.md
- Look at existing code for examples
- Create an issue asking for clarification

## Recognition

Contributors who make significant improvements will be recognized in:
- README.md acknowledgments
- GitHub contributors page
- Release notes

Thank you for contributing! 🎵
