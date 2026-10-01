import { expect, test } from 'bun:test';
import { fixtureFoundry } from '../foundry-fixture';
import {
  appendMapLog, emptyMapLog, generateMap, mapCacheKey, mapInstructions, mapMessages, mapSeed, MapOutputError, MAP_PROMPT_VERSION,
  renderMapTail, researchLogEvent, settledPrefix,
} from './map.server';
import { emptyMap, PARTICIPANT_ID } from '../../core/interview-map';
import type { TranscriptEntry } from '../../core/simulator/types';

const transcript: TranscriptEntry[] = [
  { id: 'p1', speaker: 'client', text: 'What did the project deliver, and who was the client?', startMs: 0, endMs: 4000 },
  { id: 'p2', speaker: 'trainee', text: 'A routing layer for\nthe dispatch team.', startMs: 5000, endMs: 9000 },
  { id: 'p3', speaker: 'client', text: 'Who decided on routing first?', startMs: 260_000, endMs: 262_000 },
];
const update = {
  participant: { vantage: 'Built the routing layer.', preferences: '' },
  entities: [{ id: 'e1', kind: 'product', label: 'Routing layer', detail: 'Built for dispatch, per the participant.', source: 'participant', passageId: 'p2' }],
  edges: [{ id: 'r1', kind: 'built', from: PARTICIPANT_ID, to: 'e1' }],
  threads: [{ id: 't1', label: 'Routing first', anchors: ['e1'], unknown: 'who chose to build routing first', guess: null, related: [], topics: ['client-decisions'], status: 'open', reason: null }],
  keep: [], drop: [],
};
const solResponse = (value: unknown, usage: Record<string, unknown> = { input_tokens: 9000, output_tokens: 900 }) => Response.json({
  status: 'completed', model: 'gpt-6.1-sol', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage,
});
const tail = { coverage: [{ id: 'project-delivery', level: 'touched' as const }], reasons: ['timer'], elapsedMs: 270_000, lastPassageId: 'p3' };

test('the log is append-only: new passages, continuations, corrections and events each become new lines', () => {
  const one = appendMapLog(emptyMapLog(), transcript.slice(0, 2));
  expect(one.blocks).toEqual(['[p1 · Sam · 0.0 min] What did the project deliver, and who was the client?\n[p2 · participant · 0.1 min] A routing layer for the dispatch team.']);
  expect(appendMapLog(one, transcript.slice(0, 2))).toBe(one);
  const grown = [transcript[0]!, { ...transcript[1]!, text: 'A routing layer for the dispatch team. It replaced paper maps.' }, transcript[2]!];
  const two = appendMapLog(one, grown, [{ atMs: 265_000, text: 'Public research arrived.' }]);
  expect(two.blocks[0]).toBe(one.blocks[0]!);
  expect(two.blocks[1]).toBe('[p2 · participant · continued] It replaced paper maps.\n[p3 · Sam · 4.3 min] Who decided on routing first?\n[event · 4.4 min] Public research arrived.');
  const three = appendMapLog(two, [{ ...grown[1]!, text: 'A routing layer for dispatchers.' }]);
  expect(three.blocks[2]).toBe('[p2 · participant · corrected] A routing layer for dispatchers.');
});

test('a passage still being transcribed holds back everything after it', () => {
  expect(settledPrefix(transcript, entry => entry.id !== 'p2').map(entry => entry.id)).toEqual(['p1']);
  expect(settledPrefix(transcript, () => true)).toBe(transcript);
});

test('research reaches the log as labeled public background', () => {
  expect(researchLogEvent({ kind: 'organization', name: 'Acme' }, [{ text: 'Acme makes anvils.', url: 'https://acme.example', title: 'About Acme' }]))
    .toBe('Public research about the organization "Acme" (public background, not project fact): Acme makes anvils. [About Acme]');
  expect(researchLogEvent({ kind: 'organization', name: 'Acme' }, null)).toBe('Public research about the organization "Acme" found nothing reliable.');
});

test('the seed and instructions are static, name every topic and never carry the clock', () => {
  expect(mapSeed()).toBe(mapSeed());
  expect(mapSeed()).toContain('- client-pace - Pace & approvals: The participant describes the actual pace');
  expect(mapInstructions).not.toMatch(/\d+(\.\d+)? minutes elapsed/);
  const rendered = renderMapTail(emptyMap(), { ...tail, signals: [{ threadId: 't1', state: 'answered' }] });
  expect(rendered).toContain('PREVIOUS MAP (empty: this is your first call)');
  expect(rendered).toContain('- project-delivery: touched\n- project-role: not-yet');
  expect(rendered).toContain('THREAD SIGNALS (Jev, latest participant turn; fallible)\n- t1: answered');
  expect(rendered).toContain('CLOCK\n4.5 minutes elapsed; last logged passage p3.');
});

test('breakpoints sit on the seed and the latest three log blocks; the tail is never cached', () => {
  const messages = mapMessages(['b1', 'b2', 'b3', 'b4', 'b5'], 'tail');
  expect(messages.map(item => [item.role, item.text === mapSeed() ? 'seed' : item.text, !!item.cache])).toEqual([
    ['developer', 'seed', true], ['user', 'b1', false], ['user', 'b2', false], ['user', 'b3', true], ['user', 'b4', true], ['user', 'b5', true], ['user', 'tail', false],
  ]);
});

test('the map request uses explicit caching keyed by prompt version and attempt, and reads cache usage', async () => {
  let body: Record<string, any> = {};
  const log = appendMapLog(emptyMapLog(), transcript);
  const result = await generateMap({
    foundry: fixtureFoundry, signal: new AbortController().signal, attemptId: 'attempt-1', blocks: log.blocks, previous: emptyMap(), tail, passages: transcript,
  }, async (url, options) => {
    expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
    body = JSON.parse(String(options.body));
    return solResponse(update, { input_tokens: 9000, output_tokens: 900, input_tokens_details: { cached_tokens: 7000, cache_write_tokens: 400 }, output_tokens_details: { reasoning_tokens: 500 } });
  });
  expect(body.instructions).toBe(mapInstructions);
  expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
  expect(body.prompt_cache_key).toBe(mapCacheKey('attempt-1'));
  expect(body.prompt_cache_key).toBe(`sol-map:${MAP_PROMPT_VERSION}:attempt-1`);
  expect(body.reasoning).toEqual({ effort: 'low' });
  expect(body.max_output_tokens).toBe(8000);
  expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'conversation_map_update', strict: true });
  expect(body.input.map((item: any) => [item.role, item.content[0].prompt_cache_breakpoint ?? null])).toEqual([
    ['developer', { mode: 'explicit' }], ['user', { mode: 'explicit' }], ['user', null],
  ]);
  expect(body.input[1].content[0].text).toBe(log.blocks[0]);
  expect(result.usage).toEqual({ inputTokens: 9000, outputTokens: 900, cachedTokens: 7000, cacheWriteTokens: 400, reasoningTokens: 500 });
  expect(result.map.threads[0]!.unknown).toBe('who chose to build routing first');
  expect(result.changes.added).toEqual(['e1', 'r1', 't1']);
});

test('without caching the map request sends no cache options or breakpoints', async () => {
  let body: Record<string, any> = {};
  await generateMap({
    foundry: fixtureFoundry, signal: new AbortController().signal, attemptId: 'attempt-1', blocks: ['b1'], previous: emptyMap(), tail, passages: transcript, cache: false,
  }, async (_url, options) => { body = JSON.parse(String(options.body)); return solResponse(update); });
  expect(body.prompt_cache_options).toBeUndefined();
  expect(body.prompt_cache_key).toBeUndefined();
  expect(JSON.stringify(body.input)).not.toContain('prompt_cache_breakpoint');
});

test('a rejected update reports every defect with what Sol returned', async () => {
  const run = (value: unknown) => generateMap({
    foundry: fixtureFoundry, signal: new AbortController().signal, attemptId: 'a', blocks: ['b1'], previous: emptyMap(), tail, passages: transcript,
  }, async () => solResponse(value));
  const sam = { ...update, entities: [{ ...update.entities[0]!, passageId: 'p3' }] };
  const error = await run(sam).catch(caught => caught);
  expect(error).toBeInstanceOf(MapOutputError);
  expect(error.defects).toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(error.value).toEqual(sam);
  expect(error.usage).toEqual({ inputTokens: 9000, outputTokens: 900, cachedTokens: null });
  const schema = await run({ ...update, threads: [{ ...update.threads[0]!, status: 'later' }] }).catch(caught => caught);
  expect(schema.defects[0]).toMatchObject({ kind: 'schema', id: 'threads.0.status' });
});

test('existing JSON-context Sol callers send no cache options', async () => {
  const { requestSol } = await import('../simulator/sol.server');
  const { z } = await import('zod');
  let body: Record<string, any> = {};
  await requestSol({ foundry: fixtureFoundry, signal: new AbortController().signal, instructions: 'x', context: { a: 1 }, name: 'n', schema: z.strictObject({}) },
    async (_url, options) => { body = JSON.parse(String(options.body)); return solResponse({}); });
  expect(body.input).toBe('{"a":1}');
  expect(body.max_output_tokens).toBe(1800);
  expect(body.prompt_cache_options).toBeUndefined();
});
