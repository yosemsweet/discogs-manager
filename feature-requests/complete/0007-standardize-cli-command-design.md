# Standardize CLI Command Design

Adopt the Unix-style resource-centric approach and fix all identified inconsistencies. Commands
follow the `noun verb` pattern. Every option uses hyphen-separated flags. Username is always
`--username`/`-u`. Verbose is available everywhere. The bare `playlist` command no longer has a
side-effecting default action.

---

## Target Command Map

```
discogs-cli collection sync   [-u/--username] [-f/--force] [-v/--verbose]
discogs-cli collection list   [-u/--username] [-g] [-s] [-a] [-l]
                               [--min-year] [--max-year] [--min-rating] [--max-rating]
                               [--acquired-after] [--acquired-before] [--limit] [-v/--verbose]
discogs-cli collection stats  [-u/--username] [-v/--verbose]
discogs-cli collection retry  [-u/--username]

discogs-cli soundcloud auth

discogs-cli playlist create   -t/--title <title> [-d/--description] [-g] [-s] [-a] [-l]
                               [--min-year] [--max-year] [--private]
                               [--acquired-after] [--acquired-before] [-v/--verbose]
discogs-cli playlist update   -t/--title <title> [same filters as create]
discogs-cli playlist delete   -t/--title <title> [--keep-remote] [-y/--yes]
discogs-cli playlist export   -t/--title <title> [-o/--out <filepath>]

discogs-cli playlist tracks            -t/--title <title>           # list matched tracks
discogs-cli playlist tracks review     -t/--title <title>
discogs-cli playlist tracks unmatched  -t/--title <title> [--status] [--json]
discogs-cli playlist tracks reset      -t/--title <title> [--status] [--id]

discogs-cli track lookup <url>
```

Old top-level commands (`sync`, `list`, `stats`, `auth`, `retry`, `lookup`) are removed. Running
them prints a single-line "did you mean?" message and exits 1. The bare `playlist` with no
subcommand prints its `--help` output.

---

## Change 1 — Introduce `collection` command group

Move `sync`, `list`, `stats`, and `retry` under a `collection` parent command. Each becomes a
subcommand; all existing flags and behavior are preserved.

### Success Criteria

1. `collection sync` is registered and behaves identically to the old `sync`.
2. `collection list` is registered and behaves identically to the old `list` (after the flag
   fixes in Change 3 and Change 4 below).
3. `collection stats` is registered and behaves identically to the old `stats`.
4. `collection retry` is registered and behaves identically to the old `retry` (after the fixes
   in Change 5 and Change 6 below).
5. `collection` with no subcommand prints help and exits 0.
6. The top-level bare commands `sync`, `list`, `stats`, `retry` are removed. Running any of them
   prints `"Unknown command '<name>'. Did you mean: collection <name>?"` and exits 1.
7. `discogs-cli --help` no longer lists `sync`, `list`, `stats`, `retry` as top-level commands.
8. `discogs-cli collection --help` lists all four subcommands.

### Tests (`tests/collection-command.test.ts`)

- `collection` command is registered on the program
- `collection sync` subcommand exists with `--force` flag
- `collection list` subcommand exists with `-g`, `-s`, `-a`, `-l`, `--min-year`, `--max-year`,
  `--min-rating`, `--max-rating`, `--acquired-after`, `--acquired-before`, `--limit` flags
- `collection stats` subcommand exists with `--verbose` flag
- `collection retry` subcommand exists
- `collection` with no subcommand exits 0 and prints help text
- Top-level `sync` is not registered on the root program
- Top-level `list` is not registered on the root program
- Top-level `stats` is not registered on the root program
- Top-level `retry` is not registered on the root program

---

## Change 2 — Introduce `soundcloud auth` and `track lookup`

Move `auth` under a `soundcloud` parent command. Move `lookup` under a `track` parent command.
Remove both from the top level.

### Success Criteria

1. `soundcloud auth` is registered and behaves identically to the old `auth`.
2. `soundcloud` with no subcommand prints help and exits 0.
3. `track lookup <url>` is registered and behaves identically to the old `lookup`.
4. `track` with no subcommand prints help and exits 0.
5. The top-level bare commands `auth` and `lookup` are removed; running them prints
   `"Did you mean: soundcloud auth"` / `"Did you mean: track lookup"` and exits 1.

### Tests (`tests/soundcloud-command.test.ts`, `tests/track-command.test.ts`)

**`tests/soundcloud-command.test.ts`**
- `soundcloud` command is registered on the program
- `soundcloud auth` subcommand exists
- `soundcloud` with no subcommand exits 0 and prints help text
- Top-level `auth` is not registered on the root program

**`tests/track-command.test.ts`**
- `track` command is registered on the program
- `track lookup` subcommand accepts a URL positional argument
- `track` with no subcommand exits 0 and prints help text
- Top-level `lookup` is not registered on the root program
- `track lookup` with a valid SoundCloud URL calls `resolveUrl` (not regex extraction)
- `track lookup` with a URL containing `?in=` and `&si=` query params passes the full URL to
  `resolveUrl`
- `track lookup` with a 404 response prints a clear not-found message and exits 0
- `track lookup` for a track ID not in the local DB prints "Track not found in local database"
  and exits 0
- `track lookup` output includes `https://www.discogs.com/release/<id>` for matched tracks
- `track lookup` output is plain text, not JSON

---

## Change 3 — Split `playlist` create/update; bare `playlist` prints help

Replace the bare `playlist [options]` default action with explicit `playlist create` and
`playlist update` subcommands. Running `playlist` with no subcommand prints help. Running
`playlist --title ...` with no subcommand prints a deprecation message and exits 1.

All other existing subcommands (`review`, `unmatched`, `reset`, `delete`, `export`) remain in
place; they are moved under `playlist tracks` where appropriate — see Change 7.

### Success Criteria

1. `playlist create --title <t> [filters]` creates a new playlist (same logic as the current
   default `playlist` action).
2. `playlist update --title <t> [filters]` updates an existing playlist (same logic).
3. `playlist create` and `playlist update` accept all the same filter flags as the current
   `playlist` command: `-g`, `-s`, `-a`, `-l`, `-d`, `--min-year`, `--max-year`, `--private`,
   `--acquired-after`, `--acquired-before`, `-v/--verbose`.
4. `playlist` with no subcommand and no options prints help and exits 0.
5. `playlist --title "My Jazz"` with no subcommand prints
   `"Did you mean: playlist create --title \"My Jazz\" or playlist update --title \"My Jazz\"?"`
   and exits 1 without calling any service.
6. `playlist --help` lists all subcommands including `create` and `update`.

### Tests (`tests/playlist-subcommands.test.ts`)

- `playlist create` subcommand is registered
- `playlist update` subcommand is registered
- `playlist create` has `--title`, `-g`, `-s`, `-a`, `-l`, `-d`, `--min-year`, `--max-year`,
  `--private`, `--acquired-after`, `--acquired-before`, `-v` flags
- `playlist update` has the same flags as `playlist create`
- `playlist` with no subcommand exits 0 and outputs text containing "Usage" or "Commands"
- `playlist --title "My Jazz"` with no subcommand exits 1 and prints a "did you mean?" message
  without calling `PlaylistService`
- `playlist create` with valid options calls `PlaylistService.createPlaylist` (mocked)
- `playlist update` with valid options calls `PlaylistService.createPlaylist` (update path,
  mocked)
- `playlist create` missing `--title` exits 1 with a missing required option error

---

## Change 4 — `--acquired_after` / `--acquired_before` → `--acquired-after` / `--acquired-before`

Rename both flags on `collection list` and `playlist create`/`playlist update` from underscore
to hyphen. Remove the manual camelCase workaround in `playlist.ts`.

### Success Criteria

1. `--acquired-after <date>` is the correct flag on `collection list`, `playlist create`, and
   `playlist update`.
2. `--acquired-before <date>` is the correct flag on the same three commands.
3. `--acquired_after` and `--acquired_before` (underscore) are not registered; passing them
   prints Commander's standard "unknown option" error.
4. Commander's automatic camelCase mapping (`--acquired-after` → `options.acquiredAfter`) is
   relied on; the manual `options.acquiredAfter = options.acquired_after` assignments are
   removed from `playlist.ts` and `list.ts`.
5. All downstream validation (`Validator.validateListOptions`, `Validator.validatePlaylistOptions`)
   continues to receive `acquiredAfter` / `acquiredBefore` correctly.
6. No other flags are changed.

### Tests (`tests/flag-names.test.ts`)

- `collection list` registers `--acquired-after` (hyphen), not `--acquired_after` (underscore)
- `collection list` registers `--acquired-before` (hyphen), not `--acquired_before`
- `playlist create` registers `--acquired-after`, not `--acquired_after`
- `playlist create` registers `--acquired-before`, not `--acquired_before`
- `playlist update` registers `--acquired-after` and `--acquired-before`
- Parsing `--acquired-after 2026-01-01` on `collection list` yields
  `options.acquiredAfter === '2026-01-01'` (Commander camelCase, no manual mapping needed)
- Parsing `--acquired-after 2026-01-01` on `playlist create` yields `options.acquiredAfter`
  correctly without the manual workaround
- `--acquired_after` passed to `collection list` results in an "unknown option" error

---

## Change 5 — Standardize username to `--username`/`-u` flag on all commands

`collection list` and `collection stats` currently take username as a positional argument.
`collection retry` takes it as a required positional. Standardize all to `--username`/`-u`,
with fallback to `DISCOGS_USERNAME` env var.

### Success Criteria

1. `collection list` accepts `--username <name>` / `-u <name>` and no longer has a positional
   username argument.
2. `collection stats` accepts `--username <name>` / `-u <name>` and no longer has a positional
   argument.
3. `collection retry` accepts `--username <name>` / `-u <name>` and no longer has a required
   positional argument.
4. `collection sync` already uses `--username`; confirm it is unchanged.
5. On all four commands, when `--username` is omitted, the value falls back to
   `process.env.DISCOGS_USERNAME`. If both are absent, the command exits 1 with a clear message.
6. When both `--username` and `DISCOGS_USERNAME` are set, `--username` takes priority.
7. `collection list someuser` (old positional form) is silently ignored or treated as an extra
   argument, not silently accepted as the username.

### Tests (`tests/flag-names.test.ts`)

- `collection list` does not have a registered positional argument
- `collection list` has a `--username` / `-u` option
- `collection stats` does not have a registered positional argument
- `collection stats` has a `--username` / `-u` option
- `collection retry` does not have a required positional argument
- `collection retry` has a `--username` / `-u` option
- `collection sync` has a `--username` / `-u` option (regression: unchanged)
- `--username myname` on `collection list` sets `options.username` to `'myname'`
- Omitting `--username` on `collection list` with `DISCOGS_USERNAME=envuser` set causes the
  command to use `'envuser'`
- Omitting `--username` on `collection list` with no env var set exits 1 with a clear message

---

## Change 6 — `collection retry` reads `DISCOGS_API_TOKEN`, not `DISCOGS_TOKEN`

### Success Criteria

1. `collection retry` reads `process.env.DISCOGS_API_TOKEN` for the Discogs API token.
2. `DISCOGS_TOKEN` is not referenced anywhere in the codebase.
3. When `DISCOGS_API_TOKEN` is unset, `collection retry` prints the same style of error as the
   root bootstrap check in `index.ts` and exits 1.

### Tests (`tests/flag-names.test.ts`)

- Source of `retry.ts` (or its successor) does not contain the string `DISCOGS_TOKEN`
- `collection retry` exits 1 with a clear error when `DISCOGS_API_TOKEN` is not set in env

---

## Change 7 — Move track-management subcommands under `playlist tracks`

`playlist review`, `playlist unmatched`, and `playlist reset` are moved under a `playlist tracks`
subgroup. `playlist delete` and `playlist export` remain directly under `playlist`.

### Success Criteria

1. `playlist tracks review --title <t>` is the new path for the interactive review session.
2. `playlist tracks unmatched --title <t> [--status] [--json]` is the new path.
3. `playlist tracks reset --title <t> [--status] [--id]` is the new path.
4. `playlist tracks` with no further subcommand prints help listing the three subcommands.
5. The old paths `playlist review`, `playlist unmatched`, `playlist reset` are removed. Running
   them prints `"Did you mean: playlist tracks <subcommand>?"` and exits 1.
6. `playlist delete` and `playlist export` remain directly under `playlist` (not under `tracks`).

### Tests (`tests/playlist-subcommands.test.ts`)

- `playlist tracks` is a registered subcommand of `playlist`
- `playlist tracks review` is a registered subcommand of `playlist tracks`
- `playlist tracks unmatched` is a registered subcommand with `--status` and `--json` flags
- `playlist tracks reset` is a registered subcommand with `--status` and `--id` flags
- `playlist tracks` with no subcommand exits 0 and prints help
- `playlist review` (old path) is not registered on `playlist`; exits 1 with a "did you mean?"
  message
- `playlist unmatched` (old path) is not registered; exits 1 with a "did you mean?" message
- `playlist reset` (old path) is not registered; exits 1 with a "did you mean?" message
- `playlist delete` is still a direct subcommand of `playlist` (not under `tracks`)
- `playlist export` is still a direct subcommand of `playlist` (not under `tracks`)

---

## Change 8 — Add `--verbose`/`-v` to `collection sync` and `collection list`

`--verbose`/`-v` currently exists on `playlist` and `stats`. Add it to `sync` and `list`,
wired identically to `Logger.setLogLevel(LogLevel.DEBUG)`.

### Success Criteria

1. `collection sync --verbose` enables debug logging via `Logger.setLogLevel(LogLevel.DEBUG)`.
2. `collection list --verbose` enables debug logging.
3. Without `--verbose`, log level is unchanged on both commands (no behavior change).
4. The short form `-v` works on both commands.
5. `collection stats --verbose` and `playlist create --verbose` continue to work (regression).

### Tests (`tests/flag-names.test.ts`)

- `collection sync` registers a `--verbose` / `-v` option
- `collection list` registers a `--verbose` / `-v` option
- `collection stats` still registers `--verbose` / `-v` (regression)
- `playlist create` still registers `--verbose` / `-v` (regression)

---

## Full Test File Index

| File | What it covers |
|------|----------------|
| `tests/collection-command.test.ts` | `collection` group exists; all four subcommands registered; top-level bare commands removed; `collection` alone prints help |
| `tests/soundcloud-command.test.ts` | `soundcloud auth` registered; top-level `auth` removed; bare `soundcloud` prints help |
| `tests/track-command.test.ts` | `track lookup` registered; top-level `lookup` removed; URL resolution via `/resolve`; query-param URLs; 404 handling; "not in DB" output; plain-text output; Discogs URL format |
| `tests/playlist-subcommands.test.ts` | `playlist create` and `playlist update` registered with all filter flags; bare `playlist` prints help; old-form `playlist --title` exits with "did you mean?"; `playlist tracks` group registered; `tracks review/unmatched/reset` registered; old `playlist review/unmatched/reset` paths removed; `delete` and `export` still on `playlist` directly |
| `tests/flag-names.test.ts` | `--acquired-after`/`--acquired-before` hyphen form on `list`, `playlist create`, `playlist update`; underscore form not registered; Commander camelCase mapping works without manual workaround; `--username`/`-u` on all four collection commands; no positional username on `list`, `stats`, `retry`; `--username` beats env var; missing username falls back to env or exits 1; `DISCOGS_TOKEN` not present in codebase; `collection retry` reads `DISCOGS_API_TOKEN`; `--verbose`/`-v` on `collection sync` and `collection list`; `program.version()` returns `'2.0.0'` |

---

## Change 9 — Bump version to 2.0.0

All command paths change in a backwards-incompatible way. The version in `package.json` and the
`program.version()` call in `index.ts` must reflect this.

### Success Criteria

1. `package.json` `version` is updated from `1.0.0` to `2.0.0`.
2. `discogs-cli --version` outputs `2.0.0`.
3. The version string in `index.ts` passed to `program.version()` matches `package.json`.

### Tests (`tests/flag-names.test.ts`)

- `program.version()` returns `'2.0.0'`

---

## Existing Tests That Will Need Updating

These tests reference the old command paths or flag forms and must be updated in the same PR:

- `tests/commands.test.ts` — imports `createSyncCommand`, `createListCommand`, `createStatsCommand`,
  `createPlaylistCommand` directly and tests them as top-level commands. Update to test the new
  `collection` and `playlist` subcommand structure.
- `tests/collection.test.ts` — likely calls list/filter logic; verify no command-path assumptions.
- `tests/playlist-export.test.ts` — `createExportCommand` is still under `playlist`; path unchanged
  but confirm `--acquired-after` flag name if tested.
- `tests/lookup.test.ts` — `createLookupCommand` moves to `track lookup`; update imports and
  command path in `parseAsync` calls.
- `tests/review.test.ts` — `createReviewCommand` moves to `playlist tracks review`; update command
  path in any `parseAsync` calls.
