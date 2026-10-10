# Reports

`writeNarrative(input, model, options?)` writes one Markdown report from plain input. It needs a language model and accepts an optional abort signal and telemetry. It needs no interview coordinator, voice provider, database record or catalog.

```ts
const run = writeNarrative({
  transcript: [
    { id: 'p1', speaker: 'participant', text: 'Test access arrived five days late.', startMs: 0, endMs: 3500 },
  ],
  format: { audience: 'Delivery leads', format: 'Write Findings, Lessons, and Open questions in Markdown.' },
  context: { background: 'The fictional project delivered an intake portal.' },
}, model);
for await (const chunk of run.stream) process.stdout.write(chunk);
const result = await run.result;
```

The stream contains a JSON object with a `text` field. Only model output text crosses it; private reasoning does not. The result settles with a complete document and usage, or a provider, invalid, cancelled or timeout failure. An input with no participant speech is rejected before contacting the model. The strict schema rejects maps, coverage and inferred state. Context clarifies the participant's account and does not establish findings itself.

`NarrativeRunner` bounds a generation to 120 seconds and supports joining a running stream. A disconnected reader detaches without cancelling the generation; cancellation belongs to the caller. A saved-interview host claims the generation once and uses one runner per claim. Report storage and retry authorization belong to that host. Streaming completion alone is not proof that storage succeeded.

## Synthetic inputs and isolated checks

`reportFixtures.ts` provides three reusable inputs:

- `delivery`: useful findings, a specific delay and a proposed improvement.
- `sparse`: a participant with limited involvement; the report should retain the gaps.
- `correction`: supplied background and an interviewer premise conflict with the participant; the report must preserve the correction, uncertainty and hearsay.

Run the writer and runner tests without a session, database or network service:

```sh
AGENT=1 bun test app/reports
```

The writer tests exercise the real AI SDK and stream parser with a substitute only at the paid HTTP boundary. Runner tests hold and release streams to exercise concurrency, rejoining, deadlines and cancellation. They do not assess the model's editorial quality.

Validate a synthetic input without credentials or a model call:

```sh
bun scripts/interview-narrative.ts --fixture delivery --validate
```

To generate a report independently, use the configured language model:

```sh
bun --env-file=.dev.vars scripts/interview-narrative.ts --fixture correction --out /tmp/report-result.json
bun --env-file=.dev.vars scripts/interview-narrative.ts /tmp/report-input.json --out /tmp/report-result.json
```

The JSON input accepts `{ transcript, format, context? }` directly. Read generated reports for source attribution and uncertainty; successful streaming and schema validation do not establish report quality.
