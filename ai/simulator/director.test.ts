import { expect, test } from 'bun:test';
import { directorContext, generateDirector, validateDirectorResult, type DirectorInput } from './director.server';
import { getScenario, getClient } from './scenarios.server';
import type { DirectorRecord, DetectorRecord } from '../../core/simulator/director';

const input: DirectorInput = {
  audience: 'trainee', reason: { condition: 'objective:decision', selected: true }, scenarioId: 'proposal', clientId: 'morgan',
  transcript: [{ id: 'p1', speaker: 'client', text: 'I need something for Friday.', startMs: 0, endMs: 1000 }],
  objectives: [], history: [], apiKey: 'fixture-key', signal: new AbortController().signal,
};
const intervention = { action: 'intervene', text: 'Ask what decision Friday supports.', evidenceIds: ['p1'] };
const previous = (text: string, changes: Partial<DirectorRecord> = {}): DirectorRecord => ({
  source: 'director', id: 'cue-prior', observationId: 'observation-prior', issueId: 'hint:objective:decision', audience: 'trainee', signal: { condition: 'objective:decision', selected: true },
  revision: 1, inputCount: 1, lastInputId: 'p1', snapshotAt: 1000, gateAt: 1100, model: 'gpt-6-sol', effort: 'none',
  result: { action: 'intervene', text, evidenceIds: ['p1'] }, outcome: 'published', ...changes,
});
const response = (value: unknown = intervention, overrides: Record<string, unknown> = {}) => ({
  status: 'completed', model: 'gpt-6-sol', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
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
  expect(context.context.client.role).toBe('Customer service director');
  expect(text).toContain(scenario.facts[0]!);
  expect(text).not.toContain(scenario.lead);
  expect(text).not.toContain(scenario.seriousMistake);
  expect(text).not.toContain('PRIVATE COACH NOTE');
  expect(Object.keys(context.context)).not.toContain('progress');
});

test('only delivered generated advice suppresses repetition; failed drafts and fixed alerts do not', () => {
  const alert: DetectorRecord = { source: 'detector', id: 'alert', observationId: 'observation-alert', issueId: 'trainee:mistake:1', audience: 'trainee', signal: { condition: 'mistake', probability: .99 }, revision: 1, snapshotAt: 1000, gateAt: 1100, readyAt: 1100, deliveredAt: 1100, model: 'jev', result: { action: 'intervene', text: 'Generic alert', evidenceIds: [] }, outcome: 'published' };
  const history = [previous('Already shown'), previous('Never shown', { outcome: 'stale' }), alert, previous('Failed to send', { outcome: 'error' })];
  expect(directorContext({ ...input, history }).previousInterventions).toEqual([{ condition: 'objective:decision', text: 'Already shown' }]);
  const actorHistory = [previous('Rejected', { audience: 'actor', signal: { condition: 'role', probability: .99 }, outcome: 'sent', delivery: { eventId: 'cue-rejected', status: 'rejected' } }), previous('Submitted', { audience: 'actor', signal: { condition: 'role', probability: .99 }, outcome: 'sent', delivery: { eventId: 'cue-submitted', status: 'unknown' } })];
  expect(directorContext({ ...input, audience: 'actor', reason: { condition: 'role', probability: .99 }, history: actorHistory }).previousInterventions).toEqual([{ condition: 'role', text: 'Submitted' }]);
});

test('output contract rejects fabricated evidence, unsolicited fields, empty hints, and malformed none', () => {
  for (const result of [
    { ...intervention, evidenceIds: ['p999'] }, { ...intervention, evidenceIds: ['p1', 'p1'] }, { ...intervention, audience: 'actor' },
    { ...intervention, text: ' ' }, { ...intervention, text: 'a'.repeat(161) }, { action: 'none', text: 'Advice', evidenceIds: [] },
  ]) expect(() => validateDirectorResult(result, input.transcript)).toThrow('Director output was invalid.');
  expect(validateDirectorResult({ action: 'none', text: null, evidenceIds: [] }, input.transcript).action).toBe('none');
});

test('Responses request uses Sol none, strict output, no tools, and server-only credentials', async () => {
  // Only the external HTTP boundary is substituted; serialization/parsing/validation are real.
  let body: Record<string, any> = {};
  const request = (async (url: string | URL | Request, options?: RequestInit) => {
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-key');
    body = JSON.parse(String(options?.body));
    return Response.json(response());
  });
  const result = await generateDirector(input, request);
  expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'none' }, store: false, text: { format: { type: 'json_schema', strict: true } } });
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(input.apiKey);
  expect(result).toMatchObject({ ...intervention, model: 'gpt-6-sol', usage: { inputTokens: 300, outputTokens: 30, cachedTokens: 100 } });
});

test('incomplete, refused, non-JSON, and HTTP failures never become hints', async () => {
  for (const value of [response(intervention, { status: 'incomplete' }), response(intervention, { output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'No.' }] }] }), response(intervention, { output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'bad json' }] }] })]) {
    await expect(generateDirector(input, (async () => Response.json(value)))).rejects.toThrow('Director output was invalid.');
  }
  await expect(generateDirector(input, (async () => new Response('private provider detail', { status: 429 })))).rejects.toThrow('Director request failed (429).');
});
