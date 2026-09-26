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
- Request pragmatic Opus review through computer use at the plan and implementation checkpoints; record feedback and disposition here. Commit coherent checkpoints. This follow-up is local until a new deployment is requested.

Official protocol/prompt references: [Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting) and [opening the conversation](https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks). These recommend role/tone/pace instructions and a speak-first append with active input audio, followed by listening. An instruction acknowledgment does not prove the spoken result.

## Evidence and review disposition

In progress. Baseline is commit `443c2a4`; its most recent deployed actor is unchanged from `b0e13ab`.

### Plan review

Opus 5.5 reviewed the plan through computer use. Accepted: one opening helper shared by the session owner and probe; a longer opening followed by normal short turns; specific delivery and reactions rather than generic hostility; playable WAV recordings; and silence-aware probe timing so actor pauses do not become accidental interruptions. A real interruption is a separate explicit case. Opening disclosure is checked from actual speech, not prompt text.

The public SharePoint premise already mentions files sent by email, so that symptom can legitimately appear in the kickoff and may count as a discovered problem under the existing rubric. Additional impact, ownership, history, or authority must not be handed out there. We are not silently changing discovery grading for this follow-up.

Kept the existing voices and numeric traits: this isolates the prompt change and preserves the authored stats contract. Different voices and a separate acting-quality judge are unnecessary for this iteration. The decisive acting-quality check remains human listening; automated transcript checks establish context and behavior, not an Oscar-level performance.
