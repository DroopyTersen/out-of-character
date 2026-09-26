# Spoken kickoff and stronger client performances

Andrew's first live test found two problems: the client did not establish enough context for a trainee who skipped the written brief, and the performance felt flat. This follow-up changes the existing actor instructions and authored openings, not the scoring or session architecture.

## Intended behavior

- The client leads the opening of the meeting in character. In roughly 20–30 seconds, establish who is speaking, the existing project relationship, why this conversation is happening, and what the client wants to discuss. Hand the conversation over and listen. The trainee should understand their part without reading the screen.
- Use only the public premise for this kickoff. Keep prior failures, sensitive motivations, budget, stakeholders, approval limits, and undiscovered business needs for the conversation. Do not read objectives or tell the trainee how to pass.
- Make personality immediately audible and maintain it through the conversation. Morgan applies pointed pressure and dry wit; Avery has palpable tension, guarded pauses, and earned warmth; Casey is incisive, skeptical, and animated by concrete evidence. Quiet characters need as much presence as assertive ones.
- React specifically to what the trainee just said. Unsupported promises, dismissiveness, and evasions should produce a noticeable character-specific reaction. Listening, credible pushback, and a useful tradeoff should produce an equally noticeable but proportionate change.
- Resistance still follows interests. A concession is earned by addressing the actual concern, not by enduring arbitrary hostility. No invented stakes, personal insults, repeated resolved objections, or instant purchase after one pleasant answer.

## Smallest implementation

1. Expand each existing scenario `opening` into a meeting setup using its public premise. Give the opening an explicit exception to normal short conversational turns.
2. Strengthen the existing three `behavior` descriptions with delivery and reaction direction. Add concise common guidance for committed, emotionally varied acting grounded in the authored facts.
3. Keep one shared opening instruction for production and the paid rehearsal so the test exercises the same kickoff. Preserve the existing one-time ready transition, interruption policy, privacy projection, voices, Jev rubrics, and director boundaries.
4. Reuse the opt-in responsive voice probe. Capture before/after evidence with the same synthetic trainee approach, plus the second scenario and all three personalities. Save audio for subjective review; transcripts alone cannot establish vocal quality.

## Acceptance and review

- Regression: one opening request per attempt, no opening before the browser is ready, retries do not repeat it, opening instructions stay out of public state. Assert observable protocol behavior rather than exact prompt wording.
- Real GPT-Live samples: opening explains the meeting and yields; pressure and recovery produce distinct reactions; ordinary questions receive useful answers; progress and authority limits remain credible. Inspect actual transcript and capture audio, with explicit closure and usage evidence. Record subjective audio review separately from transcript checks.
- Include a greeting-interruption case if the existing harness can support it with a small fixture change. Verify response to the interruption instead of replaying the kickoff.
- Run `bun run check`, including the existing private-bundle scan. No UI layout or scoring changes are planned.
- Request pragmatic Opus review through computer use at the plan and implementation checkpoints; record feedback and disposition here. Commit coherent checkpoints. Deployment requires Andrew's explicit request, subsequently received for the release below.

Official protocol/prompt references: [Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting) and [opening the conversation](https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks). These recommend role/tone/pace instructions and a speak-first append with active input audio, followed by listening. An instruction acknowledgment does not prove the spoken result.

## Evidence and review disposition

Baseline was commit `443c2a4`; its deployed actor was unchanged from `b0e13ab`. Implementation is committed as `3729e9a` and is now deployed from `8633f24`. Final provider checks and review disposition are recorded below.

### Plan review

Opus 5.5 reviewed the plan through computer use. Accepted: one opening helper shared by the session owner and probe; a longer opening followed by normal short turns; specific delivery and reactions rather than generic hostility; playable WAV recordings; and silence-aware probe timing so actor pauses do not become accidental interruptions. A real interruption is a separate explicit case. Opening disclosure is checked from actual speech, not prompt text.

The public SharePoint premise already mentions files sent by email, so that symptom can legitimately appear in the kickoff and may count as a discovered problem under the existing rubric. Additional impact, ownership, history, or authority must not be handed out there. We are not silently changing discovery grading for this follow-up.

Kept the existing voices and numeric traits: this isolates the prompt change and preserves the authored stats contract. Different voices and a separate acting-quality judge are unnecessary for this iteration. The decisive acting-quality check remains human listening; automated transcript checks establish context and behavior, not an Oscar-level performance.

### Implementation review and refinements

Opus found no production code or privacy blocker. The single opening trigger and protocol test were accepted. Adopted the content refinements: Avery's shared persona no longer assumes a previous bad decision; Morgan's intensity comes from precision rather than shouting; the SharePoint opening remains a regular app-project check-in with an adjacent opportunity. Private concerns are not included in the opening premise.

Actual rehearsals exposed issues worth fixing before the subjective listening check:

- The original probe started trainee speech after text settled even when audio continued. It now waits for both audible PCM and transcript quiet, while Jev observations run independently of trainee replies. A deliberately interrupted opening is a separate fixture, triggered during speech six seconds after the first audible output. This remains a silence heuristic, not a provider turn-completion guarantee.
- Earlier samples improvised supplier promises, permissions problems, and capacity claims. The actor now explicitly leaves unestablished facts unknown and creates tension through reactions to known facts.
- Avery's earlier startup included roughly 25 seconds of silence. The kickoff explicitly asks for immediate speech, and Avery's delivery guidance scopes brief hesitations to their own turn. The next measured full sales sample began in 1.4 seconds; this is an observation, not a latency guarantee.
- One later Avery sample described the assessment ceiling as implementation money. The fixed limit now explicitly says that $8,000 is assessment-only, never implementation funding, and must not be volunteered as a price. A focused budget fixture checks the distinction after a paid-assessment offer and a direct budget question.
- Scope samples still occasionally requested backend delegation despite the no-delegation prompt. Production already answers these with private role direction and performs no outside work. The probe now uses that same direction, records each delegation and its acknowledgment separately, and checks recovery. A recovered request is not evidence of perfect prompt adherence.

The implementation adds no actor state machine, scoring rule, voice setting, or UI change. The shared no-task message is extracted from existing session behavior so the rehearsal exercises that same safeguard.

### Reproducible checks

```sh
bun run check
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=sharepoint --client=morgan --plan=mixed --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=sharepoint --client=avery --plan=budget --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=sharepoint --client=avery --plan=interruption --label=review
bun --env-file=.dev.vars scripts/simulator-roleplay-probe.mjs --paid --scenario=scope --client=casey --plan=mixed --director --label=review
```

Each opt-in provider run has a three-minute deadline and records closure, usage, prompt digests, transcript, optional director observations, and playable `client-audio.wav`. No API key or private prompt text is saved. These direct WebSocket rehearsals use synthetic trainee speech; they do not exercise the browser's WebRTC path or the production director scheduler.

### Evidence record

Local recordings and reports are retained under `output/simulator-roleplay-*`. Earlier failures are preserved:

| Stage | Evidence and limitation |
| --- | --- |
| `performance-before` | Same mixed sales approach across Morgan, Avery, and Casey; 112 / 97 / 97 provider seconds; all finalized. Original short openings and text-only probe timing. |
| `performance-after` | First richer performances. Accidental probe interruptions truncated some turns; Avery's final Jev evaluation failed, and the old catch did not retain its error name. Not clean acceptance. |
| `performance-settled` | Complete sales kickoffs and distinct reactions after the PCM timing fix. All three sales runs finalized, but contained the improvised details noted above. The first scope run requested delegation four times. |
| `performance-final` | Morgan's poor approach is refused (105 seconds); Avery answers an interruption without restarting the introduction (33 seconds). These are earlier-prompt stress evidence. Scope continued requesting delegation once. |
| `performance-accepted` | Pre-final Morgan/Avery sales samples and Casey scope sample: 161 / 157 / 129 seconds, first audible output in 3.1 / 1.4 / 3.1 seconds. Kickoffs contain identity, relationship, and agenda. Record Avery's budget wording and Casey's delegation as deviations, not clean fidelity passes. The final budget constraint and Avery hesitation wording postdate these sales samples. |
| `performance-guard` | Casey scope, current committed actor/opening digests: 143 seconds, one recorded delegation, private guard acknowledged, actual in-character challenge and later bounded agreement. No errors and confirmed closure. This is a recovery pass, not zero delegation. |
| `performance-verified` budget | Avery, current committed prompts: 103 seconds, no delegation/errors, confirmed closure. Did not offer the ceiling after the paid-assessment proposal; when directly asked, correctly separated the $8,000 assessment limit from absent implementation funding and COO approval. |
| `performance-verified` interruption | Opening append acknowledged, but no audible output or transcript arrived. The 178-second session finalized at the rehearsal deadline; final grading of the empty transcript also failed. Preserve this failed startup. |
| `performance-verified-retry` interruption | Identical committed prompts, one retry: 31 seconds, first speech at 3.2 seconds, interruption sent during active speech. Avery yields, answers the actual document-workflow question, and does not restart the introduction. No errors, confirmed closure. |

Final `bun run check` passed: **114 tests, 3,777 assertions**, typecheck, production client/server builds, the 15-asset private-bundle scan, and Wrangler dry run. Evidence: `output/simulator-performance-final-gate.log`. The added tests cover one kickoff after readiness, idempotency across repeated readiness, private public-state boundaries, and the existing no-task response to a client delegation. They do not assert prompt wording or pretend to prove model behavior.

Opus's final committed-code review found no code blockers, verified the current prompt digests for the guard and budget runs, and accepted their recorded behavior. The previous suggestion to test raw instruction text in serialized JSON was corrected: the instructions contain a newline, so the test compares the JSON-escaped value. A broader substring assertion was a non-blocking suggestion; the existing public projection and bundle checks remain the boundary checks.

`output/simulator-performance-runs.json` indexes all 20 development runs, including failures (2,435 provider seconds total). Opening excerpts are in `output/simulator-performance-audio/{morgan,avery,casey}-kickoff.wav`; each is an unprocessed initial excerpt of a captured client stream. Morgan is the pre-final performance sample, Avery is the final budget sample, and Casey is the final guard sample. Full `client-audio.wav` and transcripts remain alongside every report.

Audio naturalness and whether the intensity feels right still require human listening. Provider startup variability remains a practical limit: the successful retry does not erase the silent attempt. These rehearsals do not establish a human-run conversation or physical-phone behavior. Subsequent production verification is recorded below.

Opus's final evidence review verified the 20-run index, failed startup, identical-prompt interruption retry, audio excerpts, and local-only progress record. Verdict: the wording is honest and no blocking work remains for this scoped local implementation. A production prompt for unusually long startup silence is an optional follow-up if observed in user sessions, not part of this change.

### Authorized redeployment

Andrew then requested redeployment. Release `8633f24` is live as Cloudflare version `8b61fc6c-50df-4888-a918-1b9a361d444b` with 100% traffic, verified September 26 at 16:55 UTC. The fresh full gate passes 114 tests / 3,777 assertions. Production WebRTC smoke passes 9/9 at phone width: Morgan completes a roughly 25-second contextual kickoff before the trainee speaks, real Jev feedback appears live, and provider/media cleanup completes. It used 46 provider seconds with no errors. Compact UI checks pass 5/5 and all 63 served assets match. Full receipts and limitations are in the [release record](simulator-release.md#client-performance-release).
