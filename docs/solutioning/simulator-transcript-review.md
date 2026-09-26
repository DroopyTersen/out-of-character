# Reviewing private simulator transcripts

The simulator archive is a private D1 database for developer review. It has no public transcript endpoint. Run these commands from the repository with a Cloudflare session authorized for the configured `SIMULATOR_ARCHIVE` binding:

```sh
bun scripts/simulator-transcripts.ts list
bun scripts/simulator-transcripts.ts export 123e4567-e89b-42d3-a456-426614174000
```

`list` prints the 20 most recently updated attempts and metadata only. `export` accepts one UUID and writes a JSON file to ignored `output/simulator-transcript-<id>.json`. It refuses to overwrite an existing export; move or remove that file before refreshing it. The export includes real user speech and scores; keep it untracked and share it only through an approved private channel. Add `--local` at the end of either command to inspect the isolated local D1 database. Remote is the default.

Before the first production deployment, create the database and copy its returned `database_id` into the `SIMULATOR_ARCHIVE` entry in `wrangler.jsonc`. Apply the migration before deploying the Worker:

```sh
bunx wrangler d1 create out-of-character-simulator
bunx wrangler d1 migrations apply SIMULATOR_ARCHIVE --remote
```

Local setup uses `bunx wrangler d1 migrations apply SIMULATOR_ARCHIVE --local`. The binding deliberately has no `remote: true`, so local practice never writes to production.

Records remain in D1 until an authorized developer removes them. Review retention every 90 days. After reviewing the target IDs, delete a single attempt or records older than a chosen cutoff using authenticated Wrangler commands:

```sh
bunx wrangler d1 execute SIMULATOR_ARCHIVE --remote --command "DELETE FROM simulator_attempts WHERE id = '123e4567-e89b-42d3-a456-426614174000'"
bunx wrangler d1 execute SIMULATOR_ARCHIVE --remote --command "DELETE FROM simulator_attempts WHERE updated_at < 1780000000000"
```

Use an exact validated ID and review the cutoff before running either deletion. `updated_at` is Unix milliseconds. The review script itself only reads D1.

Live attempts are checkpointed about every 30 seconds and saved once more after ending. Writes are best effort: database failures are caught and the failed save is discarded, with no durable staging or retry. If a Worker restarts, the last successful checkpoint remains `partial`; speech since it can be lost. A final-save failure may leave a partial or missing record. A `final` row means the complete captured snapshot was saved; provider finalization and score freshness are separate fields.
