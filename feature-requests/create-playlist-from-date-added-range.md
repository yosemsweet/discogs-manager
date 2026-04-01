#Scenarios

## Create a playlist from recently added records
I've recently purchased 23 new records, and I'd like to create a playlist from them. I don't always know exactly how many records I've added though, but I do know when I added them.

I want to be able to run `npm run dev -- playlist  --title "Acquired since Feb 1" --acquired_after "2026-02-01"` and have it create a new soundcloud playlist with all records I've acquired from 2026-02-01 or later.


## Create a playlist from records acquired in a specific year
I'd like to be able to create a playlist from all records I've acquired in the summer of 2024.

This should be something like `npm run dev -- playlist  --title "Summer 2024" --acquired_after "2024-06-01" --acquired_before "2024-08-15"` and have it create a new soundcloud playlist with all records I've acquired between 2024-06-01 and 2024-08-15

Success Criteria:

1. The `playlist` command accepts `--acquired_after <date>` and `--acquired_before <date>` options (ISO 8601 date strings, e.g. `2026-02-01`).
2. When `--acquired_after` is provided, only releases with `addedAt >= acquired_after` are included.
3. When `--acquired_before` is provided, only releases with `addedAt <= acquired_before` (end of day) are included.
4. Both options can be combined to define a date range (inclusive on both ends).
5. Both options can be combined with existing filters (genres, styles, artists, labels, year, rating).
6. Invalid date strings produce a clear validation error (e.g. `"not-a-date"`, `"2024-13-01"`).
7. If `--acquired_after` is later than `--acquired_before`, a validation error is raised.
8. The `PlaylistFilter` type includes optional `acquiredAfter?: Date` and `acquiredBefore?: Date` fields.
9. The `list` command also supports these options so users can preview which releases match before creating a playlist.

Tests:

### Validator (`tests/validator.test.ts` or new `tests/date-filter.test.ts`)
- Parses a valid `--acquired_after` date string into a `Date` on the filter
- Parses a valid `--acquired_before` date string into a `Date` on the filter
- Parses both options together into the filter
- Rejects an invalid date string with a `ValidationError`
- Rejects when `acquired_after` is after `acquired_before`
- Passes through `undefined` when neither option is provided (no change to existing behavior)

### CollectionService filterReleases (`tests/collection.test.ts`)
- Filters releases to only those with `addedAt` on or after `acquiredAfter`
- Filters releases to only those with `addedAt` on or before `acquiredBefore`
- Filters releases within a date range when both are provided
- Combines date filters with other filters (e.g. genre + acquiredAfter)
- Returns all releases when no date filter is set (existing behavior unchanged)
- Handles edge case: release `addedAt` exactly equals the boundary date (inclusive)

### Playlist command integration (`tests/commands.test.ts`)
- `--acquired_after` option is recognized and forwarded to the filter
- `--acquired_before` option is recognized and forwarded to the filter
- Both options together produce the correct filtered set for playlist creation
- Command fails gracefully when no releases match the date range