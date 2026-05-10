When I run `npm run dev -- playlist tracks review --title="2026 summer Beat Street pickups"` I get the following result:

```
> discogs-manager@2.1.0 dev
> ts-node src/index.ts playlist tracks review --title=2026 summer Beat Street pickups

error: required option '-t, --title <title>' not specified
```

Instead I shoudl get a list of the tracks that need fixing through the standard track matching process.

---

## Root Cause

The `playlist tracks` parent command in `src/commands/playlist.ts:346` declares its own `-t, --title <title>` option *and* hosts subcommands (`review`, `unmatched`, `reset`, `excluded`) that each `requiredOption('-t, --title <title>', ...)`. Commander.js consumes `--title` at the parent level before delegating to the subcommand, so the child sees no `--title` and aborts with the "required option not specified" error.

Reproduced with a minimal Commander.js script: removing the parent's `--title` option makes child parsing work; reinstating it reproduces the failure. The bug is independent of multi-word titles — `playlist tracks review -t testing` fails identically. Multi-word titles quoted as `--title="..."` are correctly preserved as a single `argv` entry by npm and zsh; that is not a contributing factor.

The reason the parent declared `--title` was to support a dual-purpose action: when invoked as `playlist tracks --title X`, list the matched tracks for that playlist; otherwise show help. That listing behavior should move to its own explicit subcommand so the parent stops shadowing children's options.

## Plan

1. **`src/commands/playlist.ts` — refactor `createTracksCommand`**
   - Remove the `.option('-t, --title <title>', ...)` from the `tracks` parent command (the line at ~`playlist.ts:346`).
   - Replace the parent's action body with a simple `tracksCmd.help()` call (no title-based dispatch).
   - Extract the existing "list matched tracks" logic into a new `createTracksListCommand(db)` factory that defines a `list` subcommand with `requiredOption('-t, --title <title>', ...)`, mirroring the same lookup-and-print behavior currently inside the parent action (lines ~352–370).
   - Register the new `list` subcommand on `tracksCmd` alongside `review`, `unmatched`, `reset`, `excluded`.

2. **`tests/playlist-subcommands.test.ts` — add coverage**
   - Add a test asserting `playlist tracks` has a `list` subcommand with a `--title` flag.
   - Add a parsing-level test that calls `program.parseAsync(['node','x','playlist','tracks','review','-t','foo'], { from: 'argv' })` (or similar) to confirm the `review` subcommand receives `title === 'foo'` — i.e., regression-locks the parent/child option-shadowing fix. Stub the action so the test does not hit DB or SoundCloud.
   - Repeat the parsing assertion for `unmatched`, `reset`, and `excluded` to guarantee the same fix holds for all sibling subcommands.

3. **`development-docs/systems/playlist-management/documentation.md` — update usage**
   - Add `npm run dev -- playlist tracks list --title "My Jazz"` to the Usage section, replacing any reference to `playlist tracks --title ...` if present.
   - Note in the doc that the parent `playlist tracks` (no subcommand) shows help.

4. **Manual verification**
   - `npm run dev -- playlist tracks review --title "2026 summer Beat Street pickups"` proceeds past argument parsing and reaches the review flow (DB lookup of the playlist by title; either prints the unmatched-track interactive prompt or the "no playlist found" / "no pending tracks" message).
   - `npm run dev -- playlist tracks unmatched --title "<existing playlist>"` lists pending unmatched tracks.
   - `npm run dev -- playlist tracks list --title "<existing playlist>"` prints matched tracks (the behavior previously living on the parent).
   - `npm run dev -- playlist tracks` (no args) prints help.

5. **No ADR change needed** — this is a bug fix within the existing CLI structure already governed by ADR-0004 (noun-verb). Adding a `list` verb is consistent with that ADR.

## Success Criteria

- [ ] `npm run dev -- playlist tracks review --title "<any title>"` no longer errors with `required option '-t, --title <title>' not specified`; it proceeds into `createReviewCommand`'s action with `options.title` populated correctly.
- [ ] `playlist tracks unmatched`, `playlist tracks reset`, and `playlist tracks excluded` all correctly receive `--title` (single-word *and* multi-word, with both `--title=X` and `-t X` forms).
- [ ] A new `playlist tracks list --title <title>` subcommand replaces the previous parent-action listing behavior and prints matched + unmatched-pending counts identical to the prior output.
- [ ] `playlist tracks` with no subcommand prints help (no error, exit 0 from help).
- [ ] `npm test` passes, including new parsing-regression tests in `tests/playlist-subcommands.test.ts` for each of the four `tracks` subcommands.
- [ ] `npm run lint` passes.
- [ ] `development-docs/systems/playlist-management/documentation.md` reflects the new `playlist tracks list` command.
- [ ] On completion, this feature request file moves to `feature-requests/complete/` with the next sequential number.

