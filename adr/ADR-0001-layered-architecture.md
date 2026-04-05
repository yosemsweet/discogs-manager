# ADR-0001: Layered Architecture with Dependency Injection

**Date:** 2026-01-01  
**Status:** Accepted

## Context

Discogs Manager needs to integrate two external APIs (Discogs, SoundCloud) with a local SQLite database, expose a CLI, and remain testable. Without a clear structure, API clients, business logic, and CLI parsing would become tangled and hard to test.

## Decision

Adopt a four-layer architecture with constructor-based dependency injection:

```
index.ts (bootstrap, wiring)
  → commands/  (CLI parsing, user I/O, spinners)
    → services/ (business logic, orchestration)
      → api/    (HTTP clients)
      → database (SQLite via better-sqlite3)
```

All dependencies (API clients, `DatabaseManager`) are constructed once in `src/index.ts` and passed down through constructors. No layer reaches "up" or "sideways" — dependencies only flow downward.

Commands use the `CommandBuilder` utility for consistent spinner/error handling. Each command exports a `create*Command()` factory that receives its injected dependencies.

## Consequences

- Services and commands are fully testable with mock dependencies
- Adding a new command is mechanical: implement the factory, register in `index.ts`
- The bootstrap file (`index.ts`) is the only place that knows about all concrete types
- Circular dependencies are impossible given the unidirectional flow
