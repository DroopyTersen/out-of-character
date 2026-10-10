import { expect, test } from 'bun:test';
import { foundryProvider } from '../../providers/foundry.server';
import { testFoundry } from '../../providers/testFoundry.server';
import type { ResearchRequest } from './records';
import { lookupInterviewBackground, normalizeResearchName, researchKey, validateResearchRequest } from './research.server';

const fixtureFoundry = { ...testFoundry, agentModel: 'gpt-6.1-sol', fastModel: 'gpt-6-luna' };

const transcript = [
  { id: 's1', speaker: 'interviewer' as const, text: 'Did Acme Field Systems cause the delay?', startMs: 0, endMs: 1000 },
  { id: 'p1', speaker: 'participant' as const, text: 'We connected sites at Acme—Field Systems, but the handoff was private.', startMs: 1000, endMs: 4000 },
];
const input = { signal: new AbortController().signal };
/** The lookup over the fast model, with the substituted HTTP bound into the model as the providers bind it. */
const lookup = (value: Omit<Parameters<typeof lookupInterviewBackground>[0], 'model' | 'webSearch'>, request: typeof fetch) => {
  const provider = foundryProvider(fixtureFoundry, request);
  return lookupInterviewBackground({ ...value, model: provider.responses(fixtureFoundry.fastModel), webSearch: provider.tools.webSearch({ searchContextSize: 'low' }) });
};
const response = (output: unknown[]) => Response.json({
  id: 'resp-fixture', created_at: 1, model: 'gpt-6-luna', output,
  usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
});
const message = (value: unknown, annotations: unknown[] = []) => ({
  type: 'message', id: 'msg-fixture', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text: JSON.stringify(value), annotations }],
});
const search = { type: 'web_search_call', id: 'search-fixture', status: 'completed',
  action: { type: 'search', queries: ['Acme Field Systems official operations'], sources: [{ type: 'url', url: 'https://acme.example/about' }] } };
const citation = (url: string) => ({ type: 'url_citation', url, title: 'About Acme', start_index: 0, end_index: 10 });

test('the lookup name must occur as whole words in participant speech; Sol supplies its clue', () => {
  const base: ResearchRequest = { kind: 'organization', name: 'ACME Field Systems', clue: null };
  expect(validateResearchRequest(base, transcript)).toEqual({ ok: true, request: base, passageIds: ['p1'] });
  expect(validateResearchRequest({ ...base, clue: ' an industrial supplier ' }, transcript))
    .toEqual({ ok: true, request: { ...base, clue: 'an industrial supplier' }, passageIds: ['p1'] });
  for (const name of ['Another Company', 'Acme Fie', '---', '']) {
    expect(validateResearchRequest({ ...base, name }, transcript)).toEqual({ ok: false, reason: 'name_unspoken' });
  }
  expect(validateResearchRequest(base, transcript.slice(0, 1))).toEqual({ ok: false, reason: 'name_unspoken' });
  expect(normalizeResearchName('ACME—Field  Systems!')).toBe('acme field systems');
});

test('research provenance contains every participant mention and excludes interviewer guesses', () => {
  const request: ResearchRequest = { kind: 'organization', name: 'Acme Field Systems', clue: null };
  const result = validateResearchRequest(request, [...transcript,
    { id: 'p2', speaker: 'participant', text: 'Acme Field Systems approved the design.', startMs: 4000, endMs: 6000 },
    { id: 'p3', speaker: 'participant', text: 'Acme Field supplied a part.', startMs: 6000, endMs: 7000 },
  ]);
  expect(result).toEqual({ ok: true, request, passageIds: ['p1', 'p2'] });
});

test('repeat keys ignore formatting and treat a new clue as a new attempt', () => {
  const request = { kind: 'organization' as const, name: 'Acme Field Systems', clue: null };
  expect(researchKey({ ...request, name: 'ACME—field systems' })).toBe(researchKey(request));
  expect(researchKey({ ...request, clue: 'field sites' })).not.toBe(researchKey(request));
  expect(researchKey({ ...request, kind: 'product' })).not.toBe(researchKey(request));
});

test('lookup sends only the public target and returns only provider-listed facts', async () => {
  let body: Record<string, any> = {};
  const request = (async (url: unknown, options: RequestInit) => {
    expect(String(url).split('?')[0]).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
    expect(new Headers(options.headers).get('api-key')).toBe('fixture-secret');
    body = JSON.parse(String(options.body));
    return response([search, message({ facts: [
      { text: 'Acme operates distributed field sites.', title: 'About Acme', url: 'https://acme.example/about' },
      { text: 'A fabricated project claim.', title: 'Invented', url: 'https://bad.example/claim' },
    ], unresolved: null }, [citation('https://acme.example/about')])]);
  }) as typeof fetch;
  const target = { kind: 'organization' as const, name: 'Acme Field Systems' };
  const result = await lookup({ target, clue: 'field sites', ...input }, request);
  if (result.status !== 'found') throw new Error('Expected background.');
  expect(result.facts).toEqual([{ text: 'Acme operates distributed field sites.', title: 'About Acme', url: 'https://acme.example/about' }]);
  expect(result.queries).toEqual(['Acme Field Systems official operations']);
  expect(result.retrievedAt).toBeGreaterThan(0);
  expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'low' }, max_tool_calls: 2 });
  expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'low' }]);
  expect(JSON.parse(body.input.find((item: { role: string }) => item.role === 'user').content[0].text)).toEqual({ kind: target.kind, name: target.name, clue: 'field sites' });
  expect(JSON.stringify(body)).not.toContain('p1');
  expect(JSON.stringify(body)).not.toContain('handoff was private');
});

test('uncited, non-HTTP and empty results are unresolved, with the provider reason when given', async () => {
  const target = { kind: 'organization' as const, name: 'Acme Field Systems' };
  for (const [facts, annotations] of [
    [[{ text: 'Claim', title: 'Claim', url: 'https://bad.example' }], []],
    [[{ text: 'Claim', title: 'Claim', url: 'javascript:alert(1)' }], [citation('javascript:alert(1)')]],
    [[], []],
  ] as const) {
    const request = (async () => response([search, message({ facts, unresolved: null }, [...annotations])])) as unknown as typeof fetch;
    expect(await lookup({ target, clue: null, ...input }, request)).toEqual({ status: 'unresolved', reason: 'No reliable cited public source matched.', queries: ['Acme Field Systems official operations'] });
  }
  const ambiguous = (async () => response([search, message({ facts: [], unresolved: 'Several organizations share this name.' })])) as unknown as typeof fetch;
  expect(await lookup({ target, clue: null, ...input }, ambiguous)).toMatchObject({ status: 'unresolved', reason: 'Several organizations share this name.' });
});

test('a URL annotation can substantiate a fact when search action sources are absent', async () => {
  const target = { kind: 'organization' as const, name: 'Acme Field Systems' };
  const fact = { text: 'Acme operates field sites.', title: 'About Acme', url: 'https://acme.example/about' };
  const request = (async () => response([
    { ...search, action: { type: 'search', queries: ['Acme Field Systems'] } },
    message({ facts: [fact], unresolved: null }, [citation(fact.url)]),
  ])) as unknown as typeof fetch;
  expect(await lookup({ target, clue: null, ...input }, request)).toMatchObject({ status: 'found', facts: [fact] });
});

test('provider failure makes one request', async () => {
  let calls = 0;
  const request = (async () => { calls++; return Response.json({ error: { message: 'unavailable' } }, { status: 429 }); }) as unknown as typeof fetch;
  await expect(lookup({ target: { kind: 'term', name: 'Acme' }, clue: null, ...input }, request)).rejects.toThrow();
  expect(calls).toBe(1);
});
