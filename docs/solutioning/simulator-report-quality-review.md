# Post-session report quality review

Reviewed September 27, 2026 against the thermo-nuclear code-quality review skill. Scope: the final report feature relative to main at `18827cd`, including server generation/lifecycle, archive storage, browser streaming, Storybook and verification. No release was performed.

## Independent implementation review

- **Resolved — test-file growth:** adding report integration tests pushed the existing session test past 1,000 lines. Moved its existing shared fixture to `session-fixture.ts` and added focused `session-report.test.ts`. The original test file now has 858 lines; production session logic remains 449 lines.
- **Resolved — accumulated style overrides:** the five UI passes initially layered successive CSS overrides. Consolidated them into one report styling section with one desktop and one mobile breakpoint group; removed obsolete canned-takeaway styles.
- **Resolved — evidence presentation boundary:** validation previously required a qualifying speaker somewhere in the evidence list, while the existing feedback UI displays its first item. The validator now orders the qualifying trainee/client passage first. Tests cover both skill and objective evidence. No second browser validator or new evidence-rendering abstraction was added.
- **Resolved — runtime streaming:** actual Worker-to-DO testing found gzip buffered small text chunks. The report response explicitly uses identity encoding and no-transform. The same probe found bodyless POST status reads were rejected; the client now sends the existing validated inactive activity body.
- **Resolved — lost End response:** a fatal error after reaching the live state still begins the final report exactly once. Final status refreshes the debrief transcript independently of the stopped voice connection. An actual browser flow verifies recovery.

The dedicated `SessionReport` is justified: it owns the concrete concurrency, retry, deadline, settlement and generation audit rules in one place, keeping those branches out of voice shutdown. The SDK owns stream parsing; one authenticated terminal read supplies the validated result. No second transport abstraction, background queue, resumable stream, feature flag, compatibility path or report history system was introduced.

## Claude Desktop checkpoint review

Opus 5.5 reviewed the actual implementation in Claude Desktop through computer use, with the self-contained source packet attached to the existing planning review. Initial verdict: sound checkpoint and not over-engineered.

Accepted feedback:

- Start a report after a lost End response instead of leaving it idle.
- Clear irrelevant evidence for unobserved/null skills.
- Honor the existing paid-service stop switch for report generation while retaining terminal reads.
- Try updating an existing archive row even if waiting for the final write reaches its bound.
- Restrict new request-signal forwarding to the report route.

Provider-schema concern was resolved by three real direct OpenAI calls with the strict schema; all validated. Kept the explicit input limit, evidence-ID list and one-status-read guard because they make present boundaries clear. Kept partial structured output internal to the hook/UI rather than adding a duplicate schema: rendered provisional grades and hidden partial evidence are verified in browser acceptance.

## Final review

Claude Desktop Opus received the full thermo-nuclear skill, final source, integration diff, focused tests, prior-feedback dispositions and verification evidence. Its verdict was changes requested for focused cleanup, without a redesign. Dispositions:

1. **Fixed — qualifying evidence first.** Independently identified and corrected while Claude reviewed; a rated skill now displays trainee evidence first, and an achieved discovery/outcome displays client evidence first.
2. **Fixed — invented Jev metadata.** Introduced the narrow `FeedbackAssessment` shape used by the existing score/evidence components. The final-report adapter supplies only real grades and evidence; no synthetic distributions, model names, timing or concern probabilities.
3. **Retained — standard cancellation hooks.** The local Wrangler disconnect probe does not establish production propagation behavior. Request abort and response-body cancellation remain small standard hooks, including avoiding a paid start if the request was already cancelled while voice closure was pending. The independent deadline provides the verified bound. No cancel endpoint was added.
4. **Removed — report-specific cleanup lease handling.** Normal voice cleanup proceeds independently. Integration verification exercises cleanup during report generation and checks observable completion rather than an unchanged lease.
5. **Removed — duplicate client eligibility.** The server alone rejects ungraded/silent attempts before a model call. Removed the catalog argument and client-created ineligible state.
6. **Simplified — state and display policy.** Discriminated result/state unions remove impossible combinations. The hook and Storybook share `reportView`; debrief status copy is defined once, and retry limits come from one constant.
7. **Fixed — provenance drift.** One `REPORT_PROVENANCE` definition supplies the actual provider settings and archive metadata.
8. **Fixed — restored-page spinner.** Cancelling an unfinished local report leaves a status-check action; checking re-adopts the existing attempt. Browser acceptance simulates persisted `pagehide`/`pageshow` and verifies no second generation. Physical Safari Back/Forward cache behavior remains untested.

Removed the redundant score-null check. Kept the two-caller `within` helper local to the report feature rather than broadening the shared HTTP module for an unrelated generic utility.

**Claude follow-up verdict: approved.** Opus reviewed the actual cleanup diff through Claude Desktop and accepted both retained dispositions. It found one non-blocking restored-page refinement: preserve terminal failure/ineligible/unavailable states instead of relabeling them as potentially still running. Implemented that change, and made Retry re-adopt the existing target after pagehide had invalidated it. Browser acceptance now verifies both a running report's status recovery and a failed report's working Retry after a persisted-page lifecycle.

Removed the redundant final-reading label branch Claude identified. Retained the `final` prop itself because it also selects accurate missing-evidence wording after the conversation; it is not unused. Both reviews are complete, with no unresolved blocking correctness or maintainability findings in this change.

## Evidence

- `bun run check`: 224 tests / 6,452 assertions passed, plus typecheck, build, client privacy boundary and Wrangler deployment dry run after the review fixes.
- Nine actual browser application flows passed under the framework’s default React StrictMode; no paid voice/session calls.
- Three real GPT-6 Sol medium calls: strong, weak and interrupted; validated, grounded reports of 185–207 words.
- Five screenshot/critique/fix/recapture rounds: [design review](simulator-report-design-review.md).
- Local migration `0003_simulator_report.sql` applied. Remote schema and production code unchanged.
- Cloudflare cancellation limitation: local Chrome disconnect did not reach the Worker request signal. Local SDK/status work stops immediately; the independent server deadline aborts and settles the provider when disconnect cannot propagate. The probe used an eight-second deadline; production uses 120 seconds. This is a known POC boundary, not a claim of immediate upstream cancellation.
