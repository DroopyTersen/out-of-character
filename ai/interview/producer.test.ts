import { expect, test } from 'bun:test';
import { fixtureFoundry } from '../foundry-fixture';
import { checkCard, generateProducer, producerContext, validateProducerResult, type ProducerInput } from './producer.server';
import { PRODUCER_LIMITS, type ProducerRecord, type ResearchRecord } from '../../core/interview-producer';
import type { TranscriptEntry } from '../../core/simulator/types';

const startedAt = 1_800_000_000_000;
const transcript: TranscriptEntry[] = [
  { id: 'p1', speaker: 'client', text: 'What did the team deliver?', startMs: 0, endMs: 1000 },
  { id: 'p2', speaker: 'trainee', text: 'A routing layer on OpenStreetMap.', startMs: 1000, endMs: 3000 },
];
const facts = [{ text: 'OpenStreetMap is an openly licensed world map.', url: 'https://www.openstreetmap.org/about', title: 'About OpenStreetMap' }];
const cue = (text: string, changes: Partial<ProducerRecord> = {}): ProducerRecord => ({
  source: 'producer', id: `producer-${text}`, triggers: [{ kind: 'check-in' }], queued: false, model: 'gpt-6.1-sol', effort: 'low',
  inputCount: 2, lastInputId: 'p2', triggeredAt: startedAt, startedAt, outcome: 'sent', result: { cue: text, evidenceIds: ['p2'], research: null }, ...changes,
});
const research = (changes: Partial<ResearchRecord>): ResearchRecord => ({
  source: 'research', id: 'research-1', consultationId: 'producer-1', request: { kind: 'product', name: 'OpenStreetMap', clue: null, passageIds: ['p2'] },
  model: 'gpt-6-luna', requestedAt: startedAt + 60_000, outcome: 'pending', ...changes,
});
const input: Omit<ProducerInput, 'foundry' | 'signal'> = {
  clientId: 'sam-cedar', transcript, startedAt, now: startedAt + 12 * 60_000, triggers: [{ kind: 'check-in' }],
  coverage: [{ id: 'project-delivery', level: 'explored', levels: null, probability: .914, achieved: true, evidence: { entryId: 'p2', speaker: 'trainee', text: transcript[1]!.text } }],
  history: [], budget: { cuesLeft: 15, researchLeft: 4, lookupsInFlight: 0 },
};
const solResponse = (value: unknown) => ({
  status: 'completed', model: 'gpt-6.1-sol', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 300, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } },
});
const jev = (probability: number, capture: (body: Record<string, any>) => void) => Object.assign(async (_url: string | URL | Request, options?: RequestInit) => {
  capture(JSON.parse(String(options?.body)));
  return Response.json({ model: 'jev-1.13.0', answers: { useful: { type: 'noul', noul: probability } }, usage: { input_tokens: 120, output_tokens: 8 } });
}, { preconnect: fetch.preconnect });

test('producer output needs real evidence for a cue and passes research requests through for validation', () => {
  const request = { kind: 'product' as const, name: 'OpenStreetMap', clue: null, passageIds: ['p2'] };
  expect(validateProducerResult({ cue: 'Ask what the routing layer changed for dispatchers.', evidenceIds: ['p2'], research: null }, transcript))
    .toEqual({ cue: 'Ask what the routing layer changed for dispatchers.', evidenceIds: ['p2'], research: null });
  expect(validateProducerResult({ cue: null, evidenceIds: ['p2'], research: request }, transcript)).toEqual({ cue: null, evidenceIds: [], research: request });
  for (const value of [
    { cue: 'Ask more.', evidenceIds: [], research: null }, { cue: 'Ask more.', evidenceIds: ['p9'], research: null },
    { cue: 'Ask more.', evidenceIds: ['p2', 'p2'], research: null }, { cue: 'a'.repeat(161), evidenceIds: ['p2'], research: null },
    { cue: null, evidenceIds: [], research: null, audience: 'trainee' }, { cue: null, evidenceIds: [], research: { ...request, project: 'x' } },
    { cue: null, evidenceIds: [], research: { ...request, kind: 'person' } },
  ]) expect(() => validateProducerResult(value, transcript)).toThrow('Director output was invalid.');
});

test('Sol sees purpose, clock, coverage bands, its own cue outcomes, the research log and the full dialogue', () => {
  const history = [
    cue('Sent cue', { sentAt: startedAt + 5 * 60_000, delivery: { eventId: 'cue-1', afterPassageId: 'p2', status: 'accepted' }, check: { probability: .912, inputCount: 2, lastInputId: 'p2' } }),
    cue('Withheld cue', { outcome: 'withheld', completedAt: startedAt + 6 * 60_000 }), cue('Pending cue', { outcome: 'pending' }),
    research({ outcome: 'sent', facts, retrievedAt: startedAt, delivery: { eventId: 'research-1', afterPassageId: 'p2', status: 'accepted' } }),
    research({ id: 'research-2', request: { kind: 'organization', name: 'Summit', clue: null, passageIds: ['p2'] }, outcome: 'invalid', reason: 'name_unspoken' }),
    research({ id: 'research-3', outcome: 'sent', facts, delivery: { eventId: 'research-3', afterPassageId: 'p2', status: 'rejected' } }),
  ];
  const context = producerContext({ ...input, history });
  expect(context.clock).toEqual({ elapsedMinutes: 12, targetMinutes: PRODUCER_LIMITS.targetMinutes });
  expect(context.coverage[0]!.topics[0]).toEqual({ id: 'project-delivery', label: 'Deliverables & scope', level: 'explored', pExplored: .91, evidencePassageId: 'p2' });
  expect(context.coverage[0]!.topics[1]).toMatchObject({ level: 'not-yet', pExplored: null, evidencePassageId: null });
  expect(context.pastCues).toEqual([
    { text: 'Sent cue', atMinutes: 5, outcome: 'sent', afterPassageId: 'p2', checkProbability: .91, deliveryStatus: 'accepted' },
    { text: 'Withheld cue', atMinutes: 6, outcome: 'withheld', afterPassageId: 'p2' },
  ]);
  expect(context.research).toEqual([
    { kind: 'product', name: 'OpenStreetMap', clue: null, status: 'sent', requestedAtMinutes: 1, deliveredFacts: [facts[0]!.text], afterPassageId: 'p2' },
    { kind: 'organization', name: 'Summit', clue: null, status: 'invalid', requestedAtMinutes: 1, reason: 'The name must appear exactly as spoken in a cited participant passage.' },
    { kind: 'product', name: 'OpenStreetMap', clue: null, status: 'sent', requestedAtMinutes: 1 },
  ]);
  expect(context.dialogue).toEqual([{ id: 'p1', speaker: 'sam', text: transcript[0]!.text }, { id: 'p2', speaker: 'participant', text: transcript[1]!.text }]);
  expect(JSON.stringify(context)).not.toContain(facts[0]!.url);
  expect(() => producerContext({ ...input, transcript: [] })).toThrow('Producer transcript is outside the interview limit.');
});

test('the producer request uses Sol at effort low with strict output, no tools and server-only credentials', async () => {
  let body: Record<string, any> = {};
  const result = await generateProducer({ ...input, foundry: { ...fixtureFoundry, apiKey: 'fixture-key' }, signal: new AbortController().signal }, async (url, options) => {
    expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
    expect(new Headers(options.headers).get('api-key')).toBe('fixture-key');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    body = JSON.parse(String(options.body));
    return Response.json(solResponse({ cue: 'Ask what dispatchers did differently afterward.', evidenceIds: ['p2'], research: null }));
  });
  expect(body).toMatchObject({ model: 'gpt-6.1-sol', reasoning: { effort: 'low' }, store: false, text: { format: { type: 'json_schema', strict: true } } });
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('fixture-key');
  expect(result).toMatchObject({ cue: 'Ask what dispatchers did differently afterward.', evidenceIds: ['p2'], research: null, model: 'gpt-6.1-sol' });
});

test('research identity checks send Jev the background and dialogue without coverage or private cues', async () => {
  let cardBody: Record<string, any> = {};
  const signal = new AbortController().signal;
  expect(await checkCard({ transcript, request: { kind: 'product', name: 'OpenStreetMap', clue: 'map' }, facts, apiKey: 'fixture', signal }, jev(.4, body => { cardBody = body; })))
    .toEqual({ probability: .4, usage: { inputTokens: 120, outputTokens: 8 } });
  const cardState = JSON.parse(cardBody.state);
  expect(cardState).toMatchObject({ requested: { kind: 'product', name: 'OpenStreetMap', clue: 'map' }, publicBackground: [{ text: facts[0]!.text, title: facts[0]!.title }] });
  expect(cardBody.state).not.toContain(facts[0]!.url);
  expect(cardState).not.toHaveProperty('coverage');
  expect(cardState).not.toHaveProperty('earlierCues');
  expect(cardState.dialogue.map((entry: { speaker: string }) => entry.speaker)).toEqual(['sam', 'participant']);
});
