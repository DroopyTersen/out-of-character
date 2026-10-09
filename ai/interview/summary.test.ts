import { expect, test } from 'bun:test';
import { fixtureFoundry } from '../foundry-fixture';
import { spec } from '../../interviews/project-closeout/spec';
import { summarizeInterview, type SummaryInput, type SummaryResult } from './summary.server';

// The engine's writeNarrative is tested in interview-engine/narrative. This covers the app's adapter around it.
const input: SummaryInput = { foundry: fixtureFoundry, signal: new AbortController().signal, transcript: [
  { id: 'p1', speaker: 'interviewer', text: 'Was access the problem?', startMs: 0, endMs: 900 },
  { id: 'p2', speaker: 'participant', text: 'Jen helped us fix access.', startMs: 1000, endMs: 2500 },
] };
const summary = { text: 'The participant credited Jen with resolving an access issue.' };
const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
const events = [
  { type: 'response.created', response: { id: 'summary-fixture', created_at: 1, model: fixtureFoundry.agentModel } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-1' } },
  { type: 'response.output_text.delta', item_id: 'msg-1', delta: JSON.stringify(summary) },
  { type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180, output_tokens_details: { reasoning_tokens: 30 } } } },
];

test('the closeout summary uses Sol, the spec narrative prompt and source labels, and reports before the stream ends', async () => {
  let body: Record<string, any> = {};
  const results: SummaryResult[] = [];
  const stream = summarizeInterview(input, value => results.push(value), (async (_url, options) => {
    body = JSON.parse(String(options?.body));
    return new Response(new ReadableStream({ start(controller) { events.forEach(value => controller.enqueue(event(value))); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch);
  const reader = stream.getReader();
  let text = '';
  for (;;) { const next = await reader.read(); if (next.done) break; text += next.value; }
  // SessionReport treats a stream that ends before `finish` as a provider failure.
  expect(results).toEqual([{ report: summary, failure: null, usage: { inputTokens: 100, outputTokens: 80, reasoningTokens: 30, cachedTokens: 0 } }]);
  expect(JSON.parse(text)).toEqual(summary);
  expect(body.model).toBe(fixtureFoundry.agentModel);
  expect(body.input.find((item: { role: string }) => item.role === 'developer').content).toBe((await import('../../interview-engine/narrative/narrative.prompt')).narrativeInstructions);
  const prompt = body.input.find((item: { role: string }) => item.role === 'user').content[0].text;
  expect(JSON.parse(prompt)).toEqual({ transcript: input.transcript, format: spec.plan.report });
});

test('provider failures reach finish as report-less results, and silence spends no request', async () => {
  let calls = 0;
  const results: SummaryResult[] = [];
  const request = (async () => { calls++; return Response.json({ error: { message: 'Private provider detail' } }, { status: 429 }); }) as unknown as typeof fetch;
  for await (const _ of summarizeInterview(input, value => results.push(value), request)) { /* Consume. */ }
  expect(results).toEqual([{ report: null, failure: 'provider', usage: null }]);
  expect(() => summarizeInterview({ ...input, transcript: input.transcript.slice(0, 1) }, () => {}, request)).toThrow('Interview summary unavailable.');
  expect(calls).toBe(1);
});
