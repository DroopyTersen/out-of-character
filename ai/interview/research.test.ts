import { expect, test } from 'bun:test';
import { lookupInterviewBackground, normalizeResearchName, prepareInterviewResearch } from './research.server';

const transcript = [
  { id: 's1', speaker: 'client' as const, text: 'Did Acme Field Systems cause the delay?', startMs: 0, endMs: 1000 },
  { id: 'p1', speaker: 'trainee' as const, text: 'We connected sites at Acme—Field Systems, but the handoff was private.', startMs: 1000, endMs: 4000 },
];
const input = { transcript, apiKey: 'fixture-secret', signal: new AbortController().signal };
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

test('preparation receives the bounded exchange and completed targets, and accepts a normalized participant span', async () => {
  let body: Record<string, any> = {};
  const request = (async (_url: unknown, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return response([message({ target: { kind: 'organization', name: 'ACME Field Systems', passageId: 'p1' } })]);
  }) as typeof fetch;
  const target = await prepareInterviewResearch({ ...input, alreadyResearched: ['organization:previous client'] }, request);
  expect(target).toEqual({ kind: 'organization', name: 'ACME Field Systems', passageId: 'p1' });
  expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'low' } });
  expect(body.tools).toBeUndefined();
  const context = JSON.parse(body.input.find((item: { role: string }) => item.role === 'user').content[0].text);
  expect(context.alreadyResearched).toEqual(['organization:previous client']);
  expect(context.dialogue).toEqual([
    { id: 's1', speaker: 'sam', text: transcript[0]!.text },
    { id: 'p1', speaker: 'participant', text: transcript[1]!.text },
  ]);
  expect(normalizeResearchName('ACME—Field  Systems!')).toBe('acme field systems');
});

test('preparation rejects Sam-only names, wrong passage IDs and oversized targets', async () => {
  for (const target of [
    { kind: 'organization', name: 'Acme Field Systems', passageId: 's1' },
    { kind: 'organization', name: 'Another Company', passageId: 'p1' },
    { kind: 'term', name: 'one two three four five six seven', passageId: 'p1' },
    { kind: 'term', name: '---', passageId: 'p1' },
    { kind: 'organization', name: `${'!'.repeat(100)}Acme Field Systems`, passageId: 'p1' },
  ]) {
    const request = (async () => response([message({ target })])) as unknown as typeof fetch;
    expect(await prepareInterviewResearch(input, request)).toBeNull();
  }
});

test('lookup sends only the public target and returns only provider-listed facts', async () => {
  let body: Record<string, any> = {};
  const request = (async (_url: unknown, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return response([search, message({ facts: [
      { text: 'Acme operates distributed field sites.', title: 'About Acme', url: 'https://acme.example/about' },
      { text: 'A fabricated project claim.', title: 'Invented', url: 'https://bad.example/claim' },
    ] }, [citation('https://acme.example/about')])]);
  }) as typeof fetch;
  const target = { kind: 'organization' as const, name: 'Acme Field Systems', passageId: 'p1' };
  const result = await lookupInterviewBackground({ target, apiKey: input.apiKey, signal: input.signal }, request);
  expect(result?.facts).toEqual([{ text: 'Acme operates distributed field sites.', title: 'About Acme', url: 'https://acme.example/about' }]);
  expect(result?.queries).toEqual(['Acme Field Systems official operations']);
  expect(result?.retrievedAt).toBeGreaterThan(0);
  expect(body).toMatchObject({ model: 'gpt-6-luna', store: false, reasoning: { effort: 'low' }, max_tool_calls: 2 });
  expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'low' }]);
  expect(JSON.parse(body.input.find((item: { role: string }) => item.role === 'user').content[0].text)).toEqual({ kind: target.kind, name: target.name });
  expect(JSON.stringify(body)).not.toContain('p1');
  expect(JSON.stringify(body)).not.toContain('handoff was private');
});

test('uncited, non-HTTP and empty results produce no background', async () => {
  const target = { kind: 'organization' as const, name: 'Acme Field Systems', passageId: 'p1' };
  for (const [facts, annotations] of [
    [[{ text: 'Claim', title: 'Claim', url: 'https://bad.example' }], []],
    [[{ text: 'Claim', title: 'Claim', url: 'javascript:alert(1)' }], [citation('javascript:alert(1)')]],
    [[], []],
  ] as const) {
    const request = (async () => response([search, message({ facts }, [...annotations])])) as unknown as typeof fetch;
    expect(await lookupInterviewBackground({ target, apiKey: input.apiKey, signal: input.signal }, request)).toBeNull();
  }
});

test('a URL annotation can substantiate a fact when search action sources are absent', async () => {
  const target = { kind: 'organization' as const, name: 'Acme Field Systems', passageId: 'p1' };
  const fact = { text: 'Acme operates field sites.', title: 'About Acme', url: 'https://acme.example/about' };
  const request = (async () => response([
    { ...search, action: { type: 'search', queries: ['Acme Field Systems'] } },
    message({ facts: [fact] }, [citation(fact.url)]),
  ])) as unknown as typeof fetch;
  expect((await lookupInterviewBackground({ target, apiKey: input.apiKey, signal: input.signal }, request))?.facts).toEqual([fact]);
});

test('provider failure makes one request', async () => {
  let calls = 0;
  const request = (async () => { calls++; return Response.json({ error: { message: 'unavailable' } }, { status: 429 }); }) as unknown as typeof fetch;
  await expect(prepareInterviewResearch(input, request)).rejects.toThrow();
  expect(calls).toBe(1);
});
