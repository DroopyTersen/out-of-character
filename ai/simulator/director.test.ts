import { expect, test } from 'bun:test';
import { fixtureFoundry } from '../foundry-fixture';
import { directorContext, DirectorOutputError, generateDirector, recheckDirector, validateDirectorResult, type DirectorInput } from './director.server';
import { getScenario, getClient } from './scenarios.server';
import { INTERVIEW_SCENARIO_ID } from '../../core/interview';
import type { DirectorRecord, DetectorRecord } from '../../core/simulator/director';

const input: DirectorInput = {
  audience: 'trainee', reason: { condition: 'objective:decision', selected: true }, scenarioId: 'proposal', clientId: 'morgan',
  transcript: [{ id: 'p1', speaker: 'client', text: 'I need something for Friday.', startMs: 0, endMs: 1000 }],
  objectives: [], history: [], foundry: { ...fixtureFoundry, apiKey: 'fixture-key' }, signal: new AbortController().signal,
};
const intervention = { action: 'intervene', text: 'Ask what decision Friday supports.', evidenceIds: ['p1'] };
const previous = (text: string, changes: Partial<DirectorRecord> = {}): DirectorRecord => ({
  source: 'director', id: 'cue-prior', observationId: 'observation-prior', issueId: 'hint:objective:decision', audience: 'trainee', signal: { condition: 'objective:decision', selected: true },
  revision: 1, inputCount: 1, lastInputId: 'p1', snapshotAt: 1000, gateAt: 1100, model: 'gpt-6.1-sol', effort: 'low',
  result: { action: 'intervene', text, evidenceIds: ['p1'] }, outcome: 'published', ...changes,
});
const response = (value: unknown = intervention, overrides: Record<string, unknown> = {}) => ({
  status: 'completed', model: 'gpt-6.1-sol', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 300, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } }, ...overrides,
});

test('trainee context has public briefing and dialogue, without private answers or actor history', () => {
  const scenario = getScenario(input.scenarioId), client = getClient(input.clientId);
  const text = JSON.stringify(directorContext(input));
  expect(text).toContain('I need something for Friday.');
  expect(text).toContain(scenario.lead);
  for (const privateText of [...scenario.facts, ...scenario.constraints, client.behavior, scenario.seriousMistake, ...scenario.objectives.flatMap(item => [item.criterion, item.hint])]) expect(text).not.toContain(privateText);
  const history = [previous('SECRET ACTOR NOTE', { audience: 'actor', signal: { condition: 'role', probability: .99 }, outcome: 'sent' })];
  expect(JSON.stringify(directorContext({ ...input, history }))).not.toContain('SECRET ACTOR NOTE');
});

test('actor context excludes consultant plans, scoring, and hint history', () => {
  const scenario = getScenario(input.scenarioId);
  const context = directorContext({ ...input, audience: 'actor', reason: { condition: 'role', probability: .99 }, history: [previous('PRIVATE COACH NOTE')] });
  const text = JSON.stringify(context);
  expect(context.context).toMatchObject({ client: { role: 'Customer service director' } });
  expect(text).toContain(scenario.facts[0]!);
  expect(text).not.toContain(scenario.lead);
  expect(text).not.toContain(scenario.seriousMistake);
  expect(text).not.toContain('PRIVATE COACH NOTE');
  expect(Object.keys(context.context)).not.toContain('progress');
});

test('interview scenarios are rejected; the interview producer owns Sam direction', () => {
  expect(() => directorContext({ ...input, scenarioId: INTERVIEW_SCENARIO_ID, clientId: 'sam-cedar', audience: 'actor', reason: { condition: 'missed-thread', probability: .91 } }))
    .toThrow('Interview direction uses the interview producer.');
});

test('only delivered generated advice suppresses repetition; failed drafts and fixed alerts do not', () => {
  const alert: DetectorRecord = { source: 'detector', id: 'alert', observationId: 'observation-alert', issueId: 'trainee:mistake:1', audience: 'trainee', signal: { condition: 'mistake', probability: .99 }, revision: 1, snapshotAt: 1000, gateAt: 1100, readyAt: 1100, deliveredAt: 1100, model: 'jev', result: { action: 'intervene', text: 'Generic alert', evidenceIds: [] }, outcome: 'published' };
  const history = [previous('Already shown'), previous('Never shown', { outcome: 'stale' }), alert, previous('Failed to send', { outcome: 'error' })];
  expect(directorContext({ ...input, history }).previousInterventions).toEqual([{ condition: 'objective:decision', text: 'Already shown' }]);
  const actorHistory = [previous('Rejected', { audience: 'actor', signal: { condition: 'role', probability: .99 }, deliveredAt: 1200, outcome: 'sent', delivery: { eventId: 'cue-rejected', afterPassageId: 'p1', status: 'rejected' } }), previous('Submitted', { audience: 'actor', signal: { condition: 'role', probability: .99 }, deliveredAt: 1200, outcome: 'sent', delivery: { eventId: 'cue-submitted', afterPassageId: 'p1', status: 'unknown' } })];
  expect(directorContext({ ...input, audience: 'actor', reason: { condition: 'role', probability: .99 }, history: actorHistory }).previousInterventions).toEqual([{ condition: 'role', text: 'Submitted', sentAt: 1200, afterPassageId: 'p1', deliveryStatus: 'unknown', reviewSignals: [] }]);
});

test('output contract rejects fabricated evidence, unsolicited fields, empty hints, and malformed none', () => {
  for (const result of [
    { ...intervention, evidenceIds: ['p999'] }, { ...intervention, evidenceIds: ['p1', 'p1'] }, { ...intervention, audience: 'actor' },
    { ...intervention, text: ' ' }, { ...intervention, text: 'a'.repeat(161) }, { action: 'none', text: 'Advice', evidenceIds: [] },
  ]) expect(() => validateDirectorResult(result, input.transcript)).toThrow('Director output was invalid.');
  expect(validateDirectorResult({ action: 'none', text: null, evidenceIds: [] }, input.transcript).action).toBe('none');
});

test('Responses request uses Sol low, strict output, no tools, and server-only credentials', async () => {
  // Only the external HTTP boundary is substituted; serialization/parsing/validation are real.
  let body: Record<string, any> = {};
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    expect(url).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
    expect(new Headers(options?.headers).get('api-key')).toBe('fixture-key');
    expect(new Headers(options?.headers).has('Authorization')).toBe(false);
    body = JSON.parse(String(options?.body));
    return Response.json(response());
  });
  const result = await generateDirector(input, request);
  expect(body).toMatchObject({ model: 'gpt-6.1-sol', reasoning: { effort: 'low' }, store: false, text: { format: { type: 'json_schema', strict: true } } });
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(input.foundry.apiKey);
  expect(result).toMatchObject({ ...intervention, model: 'gpt-6.1-sol', usage: { inputTokens: 300, outputTokens: 30, cachedTokens: 100 } });
});

test('incomplete, refused, non-JSON, and HTTP failures never become hints', async () => {
  for (const value of [response(intervention, { status: 'incomplete' }), response(intervention, { output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'No.' }] }] }), response(intervention, { output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'bad json' }] }] })]) {
    await expect(generateDirector(input, (async () => Response.json(value)))).rejects.toThrow(DirectorOutputError);
  }
  await expect(generateDirector(input, (async () => Response.json(response(intervention, { status: 'incomplete' }))))).rejects.toThrow('Director output was incomplete: incomplete.');
  await expect(generateDirector(input, (async () => new Response('private provider detail', { status: 429 })))).rejects.toThrow('Director request failed (429).');
});

test('trainee hint freshness checks reach Jev with and without an optional briefing', async () => {
  // Substitute paid HTTP only; the real SDK validates and serializes the context.
  const transcript = [...input.transcript, { id: 'p2', speaker: 'trainee' as const, text: 'What decision will this support?', startMs: 1000, endMs: 2000 }];
  for (const scenarioId of ['sharepoint', 'proposal']) {
    let requests = 0;
    const request = Object.assign(async (url: string | URL | Request, options?: RequestInit) => {
      requests++;
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-key');
      const body = JSON.parse(String(options?.body));
      const state = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;
      expect(state).toMatchObject({ audience: 'trainee', proposedIntervention: intervention, dialogue: [{ id: 'p1', text: input.transcript[0]!.text }, { id: 'p2', text: transcript[1]!.text }] });
      return Response.json({ model: 'jev-1.13.0', answers: { applicable: { type: 'noul', noul: .08 } }, usage: { input_tokens: 120, output_tokens: 8 } });
    }, { preconnect: fetch.preconnect });
    const result = await recheckDirector({ ...input, apiKey: 'fixture-key', audience: 'trainee', scenarioId, transcript, intervention: { ...intervention, action: 'intervene' } }, request);
    expect(requests).toBe(1);
    expect(result).toEqual({ probability: .08, usage: { inputTokens: 120, outputTokens: 8 } });
  }
});
