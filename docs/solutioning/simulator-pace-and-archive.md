# Character pace and private practice archives

Status: Opus accepted the revised plan before implementation. Andrew requested character-specific speaking speed, firmer scope bargaining from Morgan, and saved simulation transcripts that we can review to improve the actors.

## Current behavior

The deployed baseline is `8633f24`; the current checkout is `b75b636` with release documentation. Automated voice rehearsals save local transcripts and WAV files under ignored `output/`. Real browser attempts keep conversation state in memory. The Durable Object persists only a provider-closure lease, and Live is configured with `store: false`. Prior phone conversations cannot be reconstructed after that transient state is gone.

## Character tuning

- Give Morgan an explicitly brisk speaking pace, tightly connected phrases, and short purposeful pauses. Avery stays unhurried and thoughtful; Casey stays measured and becomes quicker when engaged. Put this direction in the existing private character descriptions. Change the opening's duration direction from "about 20–30 seconds" to "up to about 30 seconds" so it follows the character's pace.
- Morgan's maximum bargaining stat should be audible: test whether useful work can be included, reduced, traded or capped when cost or scope is unresolved. A confident boundary earns respect while a worthwhile bargain is still open. After a reasoned counteroffer protects delivery and meets the actual need, accept the bounded next step. Avoid obligatory objection counts, invented constraints and repeated resolved objections.
- Reuse the existing Live adapter and authored director cues. Leave `earned-progress` unchanged unless actual rehearsal or archive evidence shows it firing too early. Morgan's bargaining language stays general; any concrete trade items belong to the scenario facts. Keep the trainee scoring contract stable.
- Reuse the bounded voice rehearsal to compare Morgan before/after with the same scope approach, plus an Avery sample for contrast. Preserve transcripts and audio. Compare median words per second across client turns excluding the kickoff as an approximate pace measure; human listening remains the vocal-quality check.

Official guidance: [GPT-Live prompting](https://developers.openai.com/api/docs/guides/live-prompting) supports role-specific speaking pace through session instructions. This change proposes no new playback-rate control or persona configuration system.

## Private Cloudflare archive

Use one D1 database, one migration and one row per attempt. The archive exists for developer review of this public demo, with access through authenticated Wrangler commands. Add no public transcript-listing endpoint.

Save the attempt ID, start/update/end times, selected client and scenario, speaker-tagged transcript with timestamps, latest/final public score projection and its freshness, closure status, usage seconds, and sent director cues as IDs with send times and transcript revisions. Record model, voice, rubric version, director flag, hashes of the exact actor/opening instructions, and the Worker version ID/tag through a new version-metadata binding. Committed release tags plus prompt hashes identify the original instructions. Never save prompt/cue text, session capabilities, provider IDs, credentials, request headers, IP addresses, user agents, raw provider events, audio or raw judge internals.

- Keep D1 out of paid connection creation. Save partial snapshots on the existing 30-second alarm, and a final snapshot after closure and final grading for every attempt that reached `live`, including silent attempts. Creation failures produce no archive. Use `archive_state: partial | final | recovered`, separately from session status and provider finalization.
- Use SQL state guards: partial upserts may replace only older partials (capture-time `updated_at`); a final upsert is idempotent; recovered updates apply only to partial rows. An older partial must never replace final scores or a completed transcript. This avoids a separate sequence counter.
- Add the attempt ID to the persisted lease. Stage the final payload atomically with the closure lease before its D1 write, then flush asynchronously so `/end` is not delayed. Clear that pending key only on confirmed success. Both existing cleanup paths must preserve a pending archive. Retry on existing alarms for at most 24 hours, then log only the attempt ID and failure category and discard the undelivered payload; document this limit.
- Provider shutdown/recovery always has priority over archive I/O. An archive outage must never skip a due provider-closure attempt. For a live checkpoint, schedule the next alarm before writing and catch save failures. For a completed session, retry the pending archive before cleanup. Partials need no durable queue: the next checkpoint captures newer data.
- After a process restart, preserve the last committed checkpoint and stage a `recovered` update through the same pending-save path when provider recovery finishes. Do not replace an already staged final payload. Speech since the last checkpoint (including an attempt lost before its first checkpoint) cannot be recovered; a recovered row must not imply final grading or full transcript recovery.
- Add a concise disclosure by Start: "Transcripts and scores (no audio) are saved privately to improve the simulator." Show it before speech on mobile too. The free workshop continues making no archive/provider calls. Update the README's current no-history statement.
- Retain D1 records until explicitly removed by an authorized developer, with a documented 90-day manual retention review. Document listing recent attempts, exporting one to ignored `output/`, and deleting by ID or age. Exports contain real user speech and must stay untracked. Keep local D1 isolated from production; do not set `remote: true` on its binding.

Use the existing D1 binding API and parameterized SQL, with no ORM. References: [prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) and [migrations](https://developers.cloudflare.com/d1/reference/migrations/).

## Verification and delivery

1. Obtain Opus's review of this plan through computer use, addressing concrete simplifications or failure cases before implementation.
2. Use real SQLite for migration/upsert behavior and the existing narrow Workers/provider test boundaries for session lifecycle. Cover partial and final persistence, final-write failure/retry, cleanup deferral, restart with a staged final, recovered-over-partial only, a delayed partial write, repeated End, no row for creation failure, alarm rescheduling on write failure, retry expiry, maximum transcript size, and exclusion of capabilities/private data from archives and browser responses. Include a pending-archive failure with unconfirmed provider closure to verify shutdown still runs.
3. Run the full `bun run check` gate. Check the small disclosure at mobile and desktop widths. Verify the developer export uses authenticated Cloudflare access and safely handles attempt IDs.
4. Run focused paid character rehearsals with explicit closure. After deployment, run one real browser attempt and retrieve its D1 archive, confirming both speakers, selected client/scenario, scoring and finalization agree with the public debrief. Retain evidence of any failure.
5. Request Opus review at the implementation checkpoint, commit coherent changes, and publish the follow-up under Andrew's existing redeploy instruction once release checks pass. Delivery order: restore Cloudflare auth, create/reuse the scoped D1 database, apply its remote migration, then deploy. Verify the active Worker version and actual D1 record, not just an upload receipt.

Cloudflare readiness: read-only D1 inventory and `wrangler whoami` currently fail because the existing OAuth token expired and refresh failed. Restore the existing authenticated session before any D1 creation, migration or deployment. No cloud resource or application implementation has been changed for this follow-up.

Plan pointers: [implementation plan](simulator-implementation-plan.md), [progress](simulator-progress.md), [earlier performance evidence](simulator-roleplay-performance.md), [current release](simulator-release.md).

## Plan review disposition

Opus 5.5 reviewed the plan through computer use before implementation. Verdict: changes needed, then proceed; the MVP architecture needs no redesign. Adopted its simpler state/timestamp SQL guard, no initial D1 write, explicit archive states, durable final retry, attempt identity on the lease, bounded retry retention, digest/version provenance, cue timestamps, isolated local database, disclosure and deletion documentation, and additional lifecycle tests. The initial wording about full prompt copies is superseded by hashes plus committed release tags. One ordering correction to the review: provider shutdown must run before a failed archive flush can cause an alarm to return.

Opus accepted the revised plan and both ordering corrections. Implementation must compute the next alarm after closure/retry work so competing schedules cannot overwrite the earlier deadline; cleanup requires a closed lease and no pending archive. Restart recovery must read the pending key from storage and preserve a staged final.
