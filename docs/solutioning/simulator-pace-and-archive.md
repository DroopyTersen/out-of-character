# Character pace and private practice archives

Status: implemented and verified locally; production setup and deployment await restored Cloudflare authentication. Andrew simplified archive reliability after the initial Opus-approved plan. The implementation uses best-effort saves with no durable staging or retries. Character pace and bargaining are committed in `f582815`.

## Current behavior

At planning, the deployed baseline was `8633f24`, and the starting checkout was `b75b636` with release documentation. Automated voice rehearsals save local transcripts and WAV files under ignored `output/`. Real browser attempts keep conversation state in memory. The Durable Object persists only a provider-closure lease, and Live is configured with `store: false`. Prior phone conversations cannot be reconstructed after that transient state is gone.

## Character tuning

- Give Morgan an explicitly brisk speaking pace, tightly connected phrases, and short purposeful pauses. Avery stays unhurried and thoughtful; Casey stays measured and becomes quicker when engaged. Put this direction in the existing private character descriptions. Change the opening's duration direction from "about 20–30 seconds" to "up to about 30 seconds" so it follows the character's pace.
- Morgan's maximum bargaining stat should be audible: test whether useful work can be included, reduced, traded or capped when cost or scope is unresolved. A confident boundary earns respect while a worthwhile bargain is still open. After a reasoned counteroffer protects delivery and meets the actual need, accept the bounded next step. Avoid obligatory objection counts, invented constraints and repeated resolved objections.
- Reuse the existing Live adapter and authored director cues. Leave `earned-progress` unchanged unless actual rehearsal or archive evidence shows it firing too early. Morgan's bargaining language stays general; any concrete trade items belong to the scenario facts. Keep the trainee scoring contract stable.
- Reuse the bounded voice rehearsal to compare Morgan before/after with the same scope approach, plus an Avery sample for contrast. Preserve transcripts and audio. Compare median words per second across client turns excluding the kickoff as an approximate pace measure; human listening remains the vocal-quality check.

Official guidance: [GPT-Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) supports role-specific speaking pace through session instructions. This change proposes no new playback-rate control or persona configuration system.

## Private Cloudflare archive

Use one D1 database, one migration and one row per attempt. The archive exists for developer review of this public demo, with access through authenticated Wrangler commands. Add no public transcript-listing endpoint.

Save the attempt ID, start/update/end times, selected client and scenario, speaker-tagged transcript with timestamps, latest/final public score projection and its freshness, closure status, usage seconds, and sent director cues as IDs with send times and transcript revisions. Record model, voice, rubric version, director flag, hashes of the exact actor/opening instructions, and the Worker version ID/tag through a new version-metadata binding. Committed release tags plus prompt hashes identify the original instructions. Never save prompt/cue text, session capabilities, provider IDs, credentials, request headers, IP addresses, user agents, raw provider events, audio or raw judge internals.

- Keep D1 out of paid connection creation. Save partial snapshots on the existing 30-second alarm, and a final snapshot after closure and final grading for every attempt that reached `live`, including silent attempts. Creation failures produce no archive. Use `archive_state: partial | final`, separately from session status and provider finalization.
- Use SQL state guards: partial upserts may replace only older partials (capture-time `updated_at`); a final upsert is idempotent. An older partial must never replace final scores or a completed transcript. This avoids a separate sequence counter.
- Save fresh checkpoints and the final snapshot through background `waitUntil` work. Catch database failures and log only the attempt ID and save category. A failed save is lost; there is no durable queue, pending payload, retry alarm, recovery write or retry retention policy. A later regular checkpoint may save newer data.
- Leave the existing provider closure lease, restart recovery and cleanup behavior alone. Archive writes cannot delay `/end` or paid-provider shutdown. Schedule the normal live alarm before starting its background checkpoint.
- After a process restart, the last successful checkpoint remains `partial`. Speech since that checkpoint (including an attempt lost before its first checkpoint) can be lost. A final-save failure can leave a partial or missing record. These limitations are acceptable for this demo.
- Add a concise disclosure by Start: "Transcripts and scores (no audio) are saved privately to improve the simulator." Show it before speech on mobile too. The free workshop continues making no archive/provider calls. Update the README's current no-history statement.
- Retain D1 records until explicitly removed by an authorized developer, with a documented 90-day manual retention review. Document listing recent attempts, exporting one to ignored `output/`, and deleting by ID or age. Exports contain real user speech and must stay untracked. Keep local D1 isolated from production; do not set `remote: true` on its binding.

Use the existing D1 binding API and parameterized SQL, with no ORM. References: [prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) and [migrations](https://developers.cloudflare.com/d1/reference/migrations/).

## Verification and delivery

1. Obtain Opus's review of this plan through computer use, addressing concrete simplifications or failure cases before implementation.
2. Use real SQLite for migration/upsert behavior and the existing narrow Workers/provider test boundaries for session lifecycle. Cover partial and final persistence, failure without retry or staging, a delayed partial write, repeated End, no row for creation failure, alarm rescheduling on write failure, maximum transcript size, and exclusion of capabilities/private data from archives and browser responses. Verify database failure does not prevent provider closure or ordinary cleanup, and restart leaves the last checkpoint partial.
3. Run the full `bun run check` gate. Check the small disclosure at mobile and desktop widths. Verify the developer export uses authenticated Cloudflare access and safely handles attempt IDs.
4. Run focused paid character rehearsals with explicit closure. After deployment, run one real browser attempt and retrieve its D1 archive, confirming both speakers, selected client/scenario, scoring and finalization agree with the public debrief. Retain evidence of any failure.
5. Request Opus review at the implementation checkpoint, commit coherent changes, and publish the follow-up under Andrew's existing redeploy instruction once release checks pass. Delivery order: restore Cloudflare auth, create/reuse the scoped D1 database, apply its remote migration, then deploy. Verify the active Worker version and actual D1 record, not just an upload receipt.

Cloudflare readiness: read-only D1 inventory and `wrangler whoami` currently fail because the existing OAuth token expired and refresh failed. Restore the existing authenticated session before any D1 creation, migration or deployment. Local implementation and verification are complete; no cloud resource or deployment has been changed for this follow-up.

Plan pointers: [implementation plan](simulator-implementation-plan.md), [progress](simulator-progress.md), [earlier performance evidence](simulator-roleplay-performance.md), [current release](simulator-release.md).

## Plan review disposition

Opus 5.5 reviewed the initial plan through computer use before implementation. Andrew then explicitly simplified reliability: if D1 is unavailable, losing a save is acceptable. Durable final staging, retries, recovered rows and cleanup deferral were removed from the plan and implementation.

Opus approved the best-effort revision before it was applied. Its remaining requirements are small: restore the baseline closure lifecycle, freeze snapshots before hashing, put capture and writing inside the same catch boundary, guard optional version metadata, log only the attempt ID and save category, retain the SQL guard against stale partials, and run the focused failure/ordering tests. Remote migration must precede deployment.

## Implementation checkpoint and evidence

Opus 5.5 reviewed the simplified code through computer use and found no blocker or unnecessary complexity, conditional on the focused session tests passing. Those tests and the complete repository gate pass. The provider closure lifecycle stays unchanged; snapshot capture and writing share one catch boundary. Failed saves are dropped, and an interrupted process leaves its last successful checkpoint partial.

Verification ran from a managed isolated checkout because a separate task was expanding the catalog in the shared workspace. This checkpoint contains the original three clients and two scenarios plus the archive and pace changes. A frozen production build served on port 5181 avoids development reloads during voice tests. The concurrent catalog expansion requires its own combined verification.

- `bun run check`: 130 tests, 0 failures, 3,857 assertions; types, production builds, client privacy scan and deployment dry run pass. Log: `output/simulator-archive-check.log`.
- Focused session coverage includes silent live attempts, failed creation, unavailable D1, missing version metadata, provider closure without archive success, restart behavior and a delayed partial after a final write. SQLite tests exercise the actual migration and upsert, including the maximum transcript size.
- Frozen-build browser voice acceptance: 9/9, no errors, current live Jev feedback and confirmed provider closure. Attempt `5d34cfd7-df10-45cf-a276-6eae270e2183`, 47 usage seconds. Report: `output/simulator-archive-isolated-live/report.json`.
- Actual local D1 export: 16/16 comparisons pass. Both speakers and all transcript entries, evaluation revision 88, selection, timestamps, finalization, usage and current prompt hashes match the final browser state. The export is ignored and mode 0600; no forbidden private fields appear. Report: `output/simulator-archive-isolated-live/archive-verification.json`.
- Compact interaction checks: 5/5 at the frozen build. Report: `output/simulator-archive-isolated-compact/report.json`. The Start disclosure was also inspected at 320-pixel and desktop widths.
- Earlier shared-development failures remain under `output/simulator-best-effort-local-*`: catalog edits reloaded active sessions, and one run ended before the current live-feedback state. The harness now waits for the visible current live state before ending. The final isolated run passes that stronger check.

All evidence above is local or synthetic. Character pace measurements and their limits are in [the rehearsal record](simulator-pace-evidence.md). Cloudflare OAuth remains expired; restore authentication, add the real D1 database ID, apply the remote migration, deploy, then verify production voice and its archive before claiming cloud availability.
