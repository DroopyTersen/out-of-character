import { expect, test } from 'bun:test';
import { testFoundry } from '../../providers/testFoundry.server';
import { DirectorOutputError, structuredWith } from '../../providers/structured.server';
import type { WireEntry as TranscriptEntry } from '../wire';
import { emptyMap, MAP_LIMITS, PARTICIPANT_ID, type ConversationMap } from './map';
import * as map from './map.server';
import { emptyMapLog, mapCacheKey, MapOutputError, MAP_PROMPT_VERSION, researchLogEvent, settledPrefix, unloggedPassages, type MapLog, type MapLogEvent, type MapTail } from './map.server';
import { testSpec as spec } from './testSpec';

const fixtureFoundry = { ...testFoundry, agentModel: 'gpt-6.1-sol', fastModel: 'gpt-6-luna' };
const mapInstructions = map.mapInstructions(spec);
const mapSeed = () => map.mapSeed(spec);
const mapOutputSchema = map.mapOutputSchema(spec);
const mapWireSchema = map.mapWireSchema(spec);
const appendMapLog = (log: MapLog, settled: TranscriptEntry[], events?: MapLogEvent[]) => map.appendMapLog(spec, log, settled, events);
const renderMapTail = (previous: ConversationMap, tail: MapTail) => map.renderMapTail(spec, previous, tail);
const mapMessages = (blocks: string[], tail: string) => map.mapMessages(spec, blocks, tail);
const generateMap = (input: Omit<Parameters<typeof map.generateMap>[0], 'spec' | 'structured'>, request?: Parameters<typeof structuredWith>[1]) =>
  map.generateMap({ ...input, spec, structured: structuredWith(fixtureFoundry, request) });

const transcript: TranscriptEntry[] = [
  { id: 'p1', speaker: 'client', text: 'What did the project deliver, and who was the client?', startMs: 0, endMs: 4000 },
  { id: 'p2', speaker: 'trainee', text: 'A routing layer for\nthe dispatch team.', startMs: 5000, endMs: 9000 },
  { id: 'p3', speaker: 'client', text: 'Who decided on routing first?', startMs: 260_000, endMs: 262_000 },
];
const update = {
  vantage: 'Built the routing layer.', preferences: [],
  entities: [{ id: 'e1', kind: 'product', label: 'Routing layer', detail: 'Built for dispatch, per the participant.', source: 'participant', passageId: 'p2' }],
  edges: [{ id: 'r1', kind: 'built', from: PARTICIPANT_ID, to: 'e1' }],
  threads: [{ id: 't1', label: 'Routing first', anchors: ['e1'], unknown: 'who chose to build routing first', guess: 'the client, to unblock a demo', related: [], topics: ['client-decisions'], status: 'open', reason: null }],
  revise: [], close: [], drop: [], research: null, pace: { verdict: 'explore', reason: 'Routing first is still open.' },
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
  const two = appendMapLog(one, grown, [{ id: 'L1', atMs: 265_000, text: 'Public research arrived.' }]);
  expect(two.blocks[0]).toBe(one.blocks[0]!);
  expect(two.blocks[1]).toBe('[p2 · participant · continued] It replaced paper maps.\n[p3 · Sam · 4.3 min] Who decided on routing first?\n[event L1 · 4.4 min] Public research arrived.');
  const three = appendMapLog(two, [{ ...grown[1]!, text: 'A routing layer for dispatchers.' }]);
  expect(three.blocks[2]).toBe('[p2 · participant · corrected] A routing layer for dispatchers.');
});

test('events land in time order among the passages logged with them', () => {
  const log = appendMapLog(emptyMapLog(), transcript, [{ id: 'L3', atMs: 300_000, text: 'Late.' }, { id: 'L1', atMs: 100_000, text: 'Early.' }, { id: 'L2', atMs: 260_000, text: 'Same moment as p3.' }]);
  expect(log.blocks[0]!.split('\n').map(line => line.slice(0, 16))).toEqual([
    '[p1 · Sam · 0.0 ', '[p2 · participan', '[event L1 · 1.7 ', '[event L2 · 4.3 ', '[p3 · Sam · 4.3 ', '[event L3 · 5.0 ',
  ]);
});

test('a passage still being transcribed holds back everything after it', () => {
  expect(settledPrefix(transcript, entry => entry.id !== 'p2').map(entry => entry.id)).toEqual(['p1']);
  expect(settledPrefix(transcript, () => true)).toBe(transcript);
});

test('only settled passages whose current text the log lacks are unlogged', () => {
  const log = appendMapLog(emptyMapLog(), transcript.slice(0, 2));
  expect(unloggedPassages(log, transcript.slice(0, 2))).toEqual([]);
  const grown = [transcript[0]!, { ...transcript[1]!, text: 'A routing layer for the dispatch team. It replaced paper maps.' }, transcript[2]!];
  expect(unloggedPassages(log, grown).map(entry => entry.id)).toEqual(['p2', 'p3']);
  // Whitespace alone is not new text.
  expect(unloggedPassages(log, [transcript[0]!, { ...transcript[1]!, text: 'A routing layer for  the dispatch team. ' }])).toEqual([]);
});

test('the tail lists each lookup with its status and the lookups left', () => {
  const research = { left: 1, requests: [
    { kind: 'organization' as const, name: 'Acme', clue: 'logistics', status: 'found; see the event in the log' },
    { kind: 'term' as const, name: 'offline mode', clue: null, status: 'rejected (name_unspoken)' },
  ] };
  expect(renderMapTail(emptyMap(), { ...tail, research })).toContain('RESEARCH (1 lookup left)\n- organization "Acme" (clue: logistics): found; see the event in the log\n- term "offline mode": rejected (name_unspoken)');
  expect(renderMapTail(emptyMap(), { ...tail, research: { left: 3, requests: [] } })).toContain('RESEARCH (3 lookups left)\n- none requested yet');
  expect(renderMapTail(emptyMap(), tail)).not.toContain('RESEARCH');
});

test('a research request comes back beside the update, not inside it', async () => {
  const ask = { kind: 'product' as const, name: 'routing layer', clue: null, passageIds: ['p2'] };
  const result = await generateMap({
    signal: new AbortController().signal, attemptId: 'attempt-1', blocks: [], previous: emptyMap(), tail, passages: transcript,
  }, async () => solResponse({ ...update, research: ask }));
  expect(result.research).toEqual(ask);
  expect(result.update).not.toHaveProperty('research');
});

test('research reaches the log as labeled public background', () => {
  expect(researchLogEvent({ kind: 'organization', name: 'Acme' }, [{ text: 'Acme makes anvils.', url: 'https://acme.example', title: 'About Acme' }]))
    .toBe('Public research about the organization "Acme" (public background, not project fact): Acme makes anvils. [About Acme]');
  expect(researchLogEvent({ kind: 'organization', name: 'Acme' }, null)).toBe('Public research about the organization "Acme" found nothing reliable.');
});

test('the seed and instructions are static, name every topic and never carry the clock', () => {
  expect(mapSeed()).toBe(mapSeed());
  expect(mapSeed()).toContain('- client-pace - Pace & approvals: The participant covers pace & approvals.');
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
    signal: new AbortController().signal, attemptId: 'attempt-1', blocks: log.blocks, previous: emptyMap(), tail, passages: transcript,
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

test('Sol is sent the schema without string lengths, which zod enforces afterwards', () => {
  const wire = JSON.stringify(mapWireSchema);
  expect(wire).not.toContain('maxLength');
  expect(wire).not.toContain('minLength');
  expect(wire).toContain('"maxItems"');
  expect(JSON.stringify(mapWireSchema).length).toBeLessThan(JSON.stringify(mapOutputSchema.toJSONSchema()).length);
  const long = { ...update, threads: [{ ...update.threads[0]!, guess: 'x'.repeat(MAP_LIMITS.guess + 1) }] };
  expect(mapOutputSchema.safeParse(long).success).toBe(false);
});

test('a response cut short reports why and what it used', async () => {
  const error = await generateMap({
    signal: new AbortController().signal, attemptId: 'a', blocks: ['b1'], previous: emptyMap(), tail, passages: transcript,
  }, async () => Response.json({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, model: 'gpt-6.1-sol',
    output: [{ type: 'reasoning' }], usage: { input_tokens: 9000, output_tokens: 8000, output_tokens_details: { reasoning_tokens: 8000 } },
  })).catch(caught => caught);
  expect(error).toBeInstanceOf(DirectorOutputError);
  expect(error.detail).toBe('max_output_tokens');
  expect(error.message).toBe('Director output was incomplete: max_output_tokens.');
  expect(error.usage).toEqual({ inputTokens: 9000, outputTokens: 8000, cachedTokens: null, reasoningTokens: 8000 });
});

test('without caching the map request sends no cache options or breakpoints', async () => {
  let body: Record<string, any> = {};
  await generateMap({
    signal: new AbortController().signal, attemptId: 'attempt-1', blocks: ['b1'], previous: emptyMap(), tail, passages: transcript, cache: false,
  }, async (_url, options) => { body = JSON.parse(String(options.body)); return solResponse(update); });
  expect(body.prompt_cache_options).toBeUndefined();
  expect(body.prompt_cache_key).toBeUndefined();
  expect(JSON.stringify(body.input)).not.toContain('prompt_cache_breakpoint');
});

test('a rejected update reports every defect with what Sol returned', async () => {
  const run = (value: unknown, lookups?: string[]) => generateMap({
    signal: new AbortController().signal, attemptId: 'a', blocks: ['b1'], previous: emptyMap(), tail, passages: transcript, lookups,
  }, async () => solResponse(value));
  const sam = { ...update, entities: [{ ...update.entities[0]!, passageId: 'p3' }] };
  const error = await run(sam).catch(caught => caught);
  expect(error).toBeInstanceOf(MapOutputError);
  expect(error.defects).toEqual([{ kind: 'passage', id: 'e1', detail: 'participant fact without a participant passage' }]);
  expect(error.value).toEqual(sam);
  expect(error.usage).toEqual({ inputTokens: 9000, outputTokens: 900, cachedTokens: null });
  const schema = await run({ ...update, threads: [{ ...update.threads[0]!, status: 'later' }] }).catch(caught => caught);
  expect(schema.defects[0]).toMatchObject({ kind: 'schema', id: 'threads.0.status' });
  // A research fact cites a lookup event Sol was given.
  const research = { ...update, entities: [...update.entities, { id: 'e2', kind: 'product', label: 'Mapbox', detail: 'A mapping platform.', source: 'research', passageId: 'L1' }] };
  expect((await run(research).catch(caught => caught)).defects).toEqual([{ kind: 'passage', id: 'e2', detail: 'research fact citing L1, not a lookup event' }]);
  expect((await run(research, ['L1'])).map.entities.map(item => item.passageId)).toEqual(['p2', 'L1']);
});

test('existing JSON-context Sol callers send no cache options', async () => {
  const { requestSol } = await import('../../providers/structured.server');
  const { z } = await import('zod');
  let body: Record<string, any> = {};
  await requestSol({ foundry: fixtureFoundry, signal: new AbortController().signal, instructions: 'x', context: { a: 1 }, name: 'n', schema: z.strictObject({}) },
    async (_url, options) => { body = JSON.parse(String(options.body)); return solResponse({}); });
  expect(body.input).toBe('{"a":1}');
  expect(body.max_output_tokens).toBe(1800);
  expect(body.prompt_cache_options).toBeUndefined();
});

test('Sol settles the participant’s own part early, several responsibilities included, and keeps gap threads inside it', () => {
  const instructions = mapInstructions;
  expect(instructions).toContain('Three threads to keep in mind:');
  expect(instructions).toContain('- Their part. Until the participant has said what they themselves were responsible for, keep one thread for it');
  expect(instructions).toContain('People often hold more than one responsibility');
  expect(instructions).toContain('Never write it when their part is already clear');
  expect(instructions).toContain('prefer gap threads their stated part can answer firsthand');
  expect(MAP_PROMPT_VERSION).toBe('sol-map-v13');
});
