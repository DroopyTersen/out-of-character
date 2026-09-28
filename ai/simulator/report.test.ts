import { expect, test } from 'bun:test';
import { generateReport, generationSchema, reportContext, validateReport, type ReportInput, type ReportResult } from './report.server';
import { getScenario } from './scenarios.server';
import { skills, emptySkills } from '../../core/simulator/types';
import type { CoachingReport } from '../../core/simulator/report';
import type { DirectorRecord } from '../../core/simulator/director';

const input: ReportInput = {
  apiKey: 'fixture-secret', signal: new AbortController().signal, interventions: [],
  snapshot: { id: 'report-fixture', scenarioId: 'sharepoint', clientId: 'morgan', status: 'ended', startedAt: 0, limitSeconds: 3600,
    warning: null, revision: 3, coaching: null, feedbackStatus: 'current', message: null, finalization: 'confirmed', usageSeconds: 20,
    transcript: [
      { id: 'p1', speaker: 'client', text: 'People keep emailing documents. The operations director owns this workflow.', startMs: 0, endMs: 4000 },
      { id: 'p2', speaker: 'trainee', text: 'What happens when two people use different versions?', startMs: 4100, endMs: 7000 },
      { id: 'p3', speaker: 'client', text: 'We spend hours reconciling changes and miss deadlines.', startMs: 8000, endMs: 11000 },
    ], evaluation: { revision: 3, skills: emptySkills(), objectives: [], concern: null, model: 'jev', durationMs: 20 },
  },
};
const report = (): CoachingReport => ({
  evaluation: {
    skills: { credibility: { score: null, evidenceIds: [] }, confidence: { score: null, evidenceIds: [] }, listening: { score: 3.25, evidenceIds: ['p2'] }, rapport: { score: null, evidenceIds: [] }, clarity: { score: 3.8, evidenceIds: ['p2'] }, guidance: { score: null, evidenceIds: [] }, adaptability: { score: null, evidenceIds: [] } },
    objectives: Object.fromEntries(getScenario('sharepoint').objectives.map(({ id }) => [id, { achieved: false, evidenceIds: [] }])),
  },
  overview: 'Your focused follow-up uncovered a practical consequence of the document problem.',
  strengths: [{ text: 'Asking about version conflicts drew out the cost to the team.', evidenceIds: ['p2', 'p3'] }],
  improvements: [], nextPractice: 'Ask how often this happens before proposing a solution.',
});
const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
function events(text: string, ending: 'complete' | 'incomplete' | 'error' | 'missing' = 'complete') {
  const values: unknown[] = [
    { type: 'response.created', response: { id: 'resp-fixture', created_at: 1, model: 'gpt-6-sol' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-1' } },
    ...Array.from({ length: Math.ceil(text.length / 57) }, (_, index) => ({ type: 'response.output_text.delta', item_id: 'msg-1', delta: text.slice(index * 57, (index + 1) * 57) })),
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg-1' } },
  ];
  if (ending === 'error') values.push({ type: 'response.failed', sequence_number: 100, response: { error: { code: 'server_error', message: 'private provider detail' } } });
  else if (ending !== 'missing') values.push({ type: ending === 'complete' ? 'response.completed' : 'response.incomplete', response: {
    ...(ending === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    usage: { input_tokens: 300, output_tokens: 100, total_tokens: 400, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 60 } },
  } });
  return values;
}

test('strict scenario schema and validator preserve unobserved skills and require real qualifying evidence', () => {
  const good = validateReport(report(), input.snapshot);
  expect(good.evaluation.skills.listening.score).toBe(3.3);
  expect(good.evaluation.skills.credibility.score).toBeNull();
  const unobserved = report(); unobserved.evaluation.skills.credibility.evidenceIds = ['p2'];
  expect(validateReport(unobserved, input.snapshot).evaluation.skills.credibility.evidenceIds).toEqual([]);
  const ordered = report(); ordered.evaluation.skills.listening.evidenceIds = ['p1', 'p2'];
  expect(validateReport(ordered, input.snapshot).evaluation.skills.listening.evidenceIds).toEqual(['p2', 'p1']);
  const objective = getScenario('sharepoint').objectives.find(item => item.kind === 'discovery')!.id;
  ordered.evaluation.objectives[objective] = { achieved: true, evidenceIds: ['p2', 'p3'] };
  expect(validateReport(ordered, input.snapshot).evaluation.objectives[objective]!.evidenceIds).toEqual(['p3', 'p2']);
  for (const mutate of [
    (value: CoachingReport) => { value.evaluation.skills.clarity.score = 4.01; },
    (value: CoachingReport) => { value.evaluation.skills.clarity.evidenceIds = ['p999']; },
    (value: CoachingReport) => { value.evaluation.skills.clarity.evidenceIds = ['p1']; },
    (value: CoachingReport) => { value.strengths[0]!.evidenceIds = ['p2', 'p2']; },
    (value: CoachingReport) => { delete value.evaluation.objectives[objective]; },
    (value: CoachingReport) => { value.evaluation.objectives[objective] = { achieved: true, evidenceIds: ['p2'] }; },
    (value: CoachingReport) => { value.evaluation.objectives.invented = { achieved: false, evidenceIds: [] }; },
    (value: CoachingReport) => { value.evaluation.skills.guidance = { score: 2, evidenceIds: [] }; },
  ]) { const value = report(); mutate(value); expect(() => validateReport(value, input.snapshot)).toThrow(); }
  expect(generationSchema('sharepoint').safeParse({ ...report(), rawReasoning: 'hidden' }).success).toBe(false);
});

test('report context contains private scenario, Jev and delivered advice without rejected drafts or credentials', () => {
  const prior: DirectorRecord = { source: 'director', id: 'cue', observationId: 'observation', issueId: 'role', audience: 'actor', signal: { condition: 'role', probability: .9 }, revision: 2, inputCount: 2, lastInputId: 'p2', snapshotAt: 1000, gateAt: 1100, model: 'gpt-6-sol', effort: 'none', outcome: 'sent', deliveredAt: 1200, result: { action: 'intervene', text: 'Stay cautious.', evidenceIds: ['p1'] }, delivery: { eventId: 'cue-1', afterPassageId: 'p2', status: 'accepted' } };
  const context = reportContext({ ...input, interventions: [prior, { ...prior, id: 'bad', result: { action: 'intervene', text: 'Rejected cue', evidenceIds: ['p1'] }, delivery: { ...prior.delivery!, status: 'rejected' } }, { ...prior, id: 'stale', outcome: 'stale' }] });
  expect(context.privateClientContext.facts).toContain(getScenario('sharepoint').facts[0]!);
  expect(context.jev.assessment?.model).toBe('jev');
  expect(context.deliveredAdvice).toEqual([{ audience: 'actor', text: 'Stay cautious.', evidenceIds: ['p1'], deliveredAt: 1200, throughPassageId: 'p2', deliveryStatus: 'accepted' }]);
  expect(JSON.stringify(context)).not.toContain('fixture-secret');
  expect(context.rubric.map(item => item.id)).toEqual(skills.map(item => item.id));
});

test('real SDK streams structured text with Sol medium, strict schema, no storage and audited token usage', async () => {
  // Substitute only the external HTTP service; use the real SDK/provider and schemas.
  let body: Record<string, any> = {}, calls = 0;
  let result: ReportResult | undefined;
  const request = (async (url, options) => {
    calls++; expect(String(url)).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-secret');
    body = JSON.parse(String(options?.body));
    return sse(events(JSON.stringify(report())));
  }) as typeof fetch;
  let chunks = 0, text = '';
  for await (const chunk of generateReport(input, value => { result = value; }, request)) { chunks++; text += chunk; }
  expect(chunks).toBeGreaterThan(2);
  expect(JSON.parse(text).overview).toBe(report().overview);
  expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'medium' }, store: false, max_output_tokens: 12000, text: { format: { type: 'json_schema', strict: true } } });
  expect(body.tools).toBeUndefined();
  expect(body.text.format.schema.properties.evaluation.properties.objectives.additionalProperties).toBe(false);
  expect(result).toMatchObject({ failure: null, usage: { inputTokens: 300, outputTokens: 100, reasoningTokens: 60, cachedTokens: 40 } });
  expect(result!.report!.evaluation.skills.listening.score).toBe(3.3);
  expect(calls).toBe(1);
});

test('bad schema, bad evidence, truncation, refusal and late provider errors never validate as a final report', async () => {
  const bad = report(); bad.strengths[0]!.evidenceIds = ['p999'];
  for (const [text, ending] of [[JSON.stringify(bad), 'complete'], ['{"overview":"partial"', 'complete'], [JSON.stringify(report()), 'incomplete'], ['', 'complete'], [JSON.stringify(report()), 'error'], [JSON.stringify(report()), 'missing']] as const) {
    const outcomes: ReportResult[] = [];
    const stream = generateReport(input, value => { outcomes.push(value); }, (async () => sse(events(text, ending))) as unknown as typeof fetch);
    for await (const _ of stream) { /* Drain the actual SDK stream. */ }
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.some(value => !!value.report)).toBe(false);
  }
});

test('provider HTTP failures have no automatic retries and no provider detail in the report', async () => {
  let calls = 0;
  const outcomes: ReportResult[] = [];
  const stream = generateReport(input, value => { outcomes.push(value); }, (async () => { calls++; return Response.json({ error: { message: 'private request info', type: 'rate_limit_error' } }, { status: 429 }); }) as unknown as typeof fetch);
  for await (const _ of stream) { /* Drain. */ }
  expect(calls).toBe(1);
  expect(outcomes).toEqual([{ report: null, failure: 'provider', usage: null }]);
  expect(JSON.stringify(outcomes)).not.toContain('private request info');
});
