# ADR-0004 — Unix-style `noun verb` CLI command structure

**Status:** Accepted  
**Date:** 2026-04-04

---

## Context

The original CLI had a flat command surface: `sync`, `list`, `stats`, `retry`, `auth`, `lookup`,
and `playlist` were all top-level commands. This created several problems:

- **Inconsistent conventions.** `list` and `stats` accepted username as a positional argument;
  `sync` used `--username`/`-u`. Flags used underscore form (`--acquired_after`) in some places
  and hyphen form in others. `retry` read `DISCOGS_TOKEN` while `index.ts` defined
  `DISCOGS_API_TOKEN`.
- **Ambiguous `playlist`.** The bare `playlist [options]` command had a side-effecting default
  action (create-or-update). There was no way to create vs. update intentionally, and the command
  printed nothing useful when called with no arguments.
- **Flat command list.** As the tool grew (adding `lookup`, `export`, `review`, `unmatched`,
  `reset`) the top-level help became hard to scan and gave no indication of which commands were
  related.

---

## Decision

Adopt the **Unix-style resource-centric `noun verb` pattern** for all commands. Commands are
grouped under a resource noun; actions are expressed as verbs (subcommands).

```
collection sync / list / stats / retry
soundcloud auth
playlist create / update / delete / export
playlist tracks review / unmatched / reset
track lookup
```

The following rules apply uniformly across all commands:

| Rule | Detail |
|------|--------|
| Username flag | `--username`/`-u` on every collection command; falls back to `DISCOGS_USERNAME` env var; no positional username arguments |
| Hyphen flags | All multi-word flags use hyphens (`--acquired-after`, not `--acquired_after`); Commander's automatic camelCase mapping (`acquiredAfter`) is relied on directly |
| Verbose flag | `--verbose`/`-v` on every command that produces filterable output |
| Env var naming | `DISCOGS_API_TOKEN` everywhere; `DISCOGS_TOKEN` removed |
| Bare parent commands | Printing help, never performing side effects |
| Removed paths | Old top-level commands print a one-line "Did you mean?" hint and exit 1 |

This constitutes a **breaking change** — all command invocations change — so the version was
bumped to 2.0.0.

---

## New Command Files

| File | Responsibility |
|------|---------------|
| `src/commands/collection.ts` | `collection` group: wraps `sync`, `list`, `stats`, `retry` |
| `src/commands/soundcloud.ts` | `soundcloud` group: wraps `auth` |
| `src/commands/track.ts` | `track` group: wraps `lookup` |

The `playlist` command was refactored in place (`src/commands/playlist.ts`) to replace the
default action with explicit `create` and `update` subcommands, and to move `review`,
`unmatched`, and `reset` under a `playlist tracks` subgroup.

---

## Consequences

**Positive:**
- The help output is self-documenting: related commands are grouped, and the noun tells you what
  resource you're acting on.
- Flag naming is now fully consistent and predictable.
- Bare parent commands are safe to run accidentally (they print help, not side effects).
- "Did you mean?" hints make the transition from v1 less painful.

**Negative:**
- All existing shell scripts or documentation referencing v1 command paths must be updated.
- The version bump signals the break clearly, but users who do not read release notes will see
  "command not found" errors until they update their invocations.
