import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { vendorReview } from '../../../interview-engine/setup/setup.test';
import { spec as projectCloseout } from '../../../interviews/project-closeout/spec';
import { spec as salesWinLoss } from '../../../interviews/sales-win-loss/spec';
import { d1DebriefStore, memoryDebriefStore, routeDebriefs, specCatalog, templates, type DebriefGates, type DebriefStore } from './debriefs';
import { routeInterview, type InterviewGates } from './routes';

const migration = await Bun.file(new URL('../../../migrations/0005_debrief_specs.sql', import.meta.url)).text();

/** D1 as far as the debrief store uses it, over SQLite. */
function d1Database() {
  const sqlite = new Database(':memory:');
  sqlite.exec(migration);
  const db = {
    prepare: (sql: string) => ({ bind: (...values: (string | number | null)[]) => ({
      first: async () => sqlite.prepare(sql).get(...values),
      run: async () => { sqlite.prepare(sql).run(...values); return { success: true }; },
    }) }),
  } as unknown as D1Database;
  return { db, count: () => (sqlite.query('SELECT COUNT(*) AS n FROM debrief_specs').get() as { n: number }).n };
}

const record = { ...vendorReview, id: 'quarterly-vendor-review', base: projectCloseout.id };

async function storeBehaves(store: DebriefStore) {
  expect(await store.get('quarterly-vendor-review')).toBeNull();
  await store.put({ id: record.id, version: 'quarterly-vendor-review-aaaaaaaaaaaa', base: record.base, approvedAt: 1000, record });
  await store.put({ id: record.id, version: 'quarterly-vendor-review-aaaaaaaaaaaa', base: record.base, approvedAt: 1500, record });
  await store.put({ id: record.id, version: 'quarterly-vendor-review-bbbbbbbbbbbb', base: record.base, approvedAt: 2000, record: { ...record, title: 'Quarterly Vendor Review (edited)' } });
  expect((await store.get('quarterly-vendor-review'))!.version).toBe('quarterly-vendor-review-bbbbbbbbbbbb');
  expect((await store.get('quarterly-vendor-review', 'quarterly-vendor-review-aaaaaaaaaaaa'))!.record).toEqual(record);
  expect(await store.get('quarterly-vendor-review', 'quarterly-vendor-review-cccccccccccc')).toBeNull();
}

test('the D1 store and the memory store keep every approved version and answer with the latest by default', async () => {
  const d1 = d1Database();
  await storeBehaves(d1DebriefStore(d1.db));
  expect(d1.count()).toBe(2);
  await storeBehaves(memoryDebriefStore());
});

test('the catalog serves templates by id and rebuilds approved debriefs on their base, exactly by version', async () => {
  const store = memoryDebriefStore();
  const catalog = specCatalog(store);
  expect(await catalog.resolve(projectCloseout.id)).toBe(projectCloseout);
  expect(await catalog.resolve(salesWinLoss.id, salesWinLoss.version)).toBe(salesWinLoss);
  expect(await catalog.resolve(projectCloseout.id, 'project-closeout-v0')).toBeNull();
  expect(await catalog.resolve('quarterly-vendor-review')).toBeNull();
  const gates: DebriefGates = { store, catalog };
  const approved = await setup(gates, '', record);
  expect(approved.status).toBe(201);
  const { id, version } = await approved.json() as { id: string; version: string };
  const spec = (await catalog.resolve(id))!;
  expect(spec.version).toBe(version);
  expect(spec.topics.map(topic => topic.id)).toEqual(['relationship', 'future']);
  expect(spec.interviewer.voices).toBe(projectCloseout.interviewer.voices);
  expect(await catalog.resolve(id, version)).toMatchObject({ id, version });
  expect(await catalog.resolve(id, 'quarterly-vendor-review-000000000000')).toBeNull();
  // Approving an edit adds a version; the first stays resolvable, and the latest is the default.
  const edited = await setup(gates, '', { ...record, title: 'Quarterly Vendor Review, edited' });
  const next = await edited.json() as { version: string };
  expect(next.version).not.toBe(version);
  expect((await catalog.resolve(id))!.version).toBe(next.version);
  expect((await catalog.resolve(id, version))!.version).toBe(version);
});

const origin = 'https://practice.example';
const setup = (gates: DebriefGates | undefined, path: string, body?: unknown, headers: Record<string, string> = {}, paid = { available: () => true, limit: async () => true }) =>
  routeDebriefs(new Request(`${origin}/api/interview/debriefs${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), new URL(`${origin}/api/interview/debriefs${path}`), gates, paid);

test('setup routes: templates as drafts, drafts from a description, approval, and reading an approved debrief back', async () => {
  const drafted: { description: string; base: string }[] = [];
  const gates: DebriefGates = { store: memoryDebriefStore(), catalog: specCatalog(memoryDebriefStore()), draft: async input => { drafted.push({ description: input.description, base: input.base.id }); return { draft: vendorReview, model: 'agent', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  gates.catalog = specCatalog(gates.store);
  expect((await setup(undefined, '/templates')).status).toBe(404);
  expect((await setup(gates, '/templates', undefined, { Origin: 'https://elsewhere.example' })).status).toBe(403);
  const listed = await (await setup(gates, '/templates')).json() as { templates: { id: string; version: string; base: string; draft: { topics: unknown[] } }[] };
  expect(listed.templates.map(template => [template.id, template.version, template.base])).toEqual(templates.map(spec => [spec.id, spec.version, spec.id]));
  expect(listed.templates[0]!.draft.topics).toHaveLength(projectCloseout.topics.length);

  expect((await setup(gates, '/drafts', { description: 'A quarterly review of the vendor relationship Priya managed.' }, {}, { available: () => false, limit: async () => true })).status).toBe(503);
  expect((await setup(gates, '/drafts', { description: 'A quarterly review of the vendor relationship Priya managed.' }, {}, { available: () => true, limit: async () => false })).status).toBe(429);
  expect((await setup(gates, '/drafts', { description: 'short' })).status).toBe(400);
  expect((await setup(gates, '/drafts', { description: 'A quarterly review of the vendor relationship Priya managed.', base: 'no-such-template' })).status).toBe(400);
  const draft = await setup(gates, '/drafts', { description: 'A quarterly review of the vendor relationship Priya managed.', base: salesWinLoss.id });
  expect(draft.status).toBe(200);
  expect(await draft.json() as unknown).toEqual({ base: salesWinLoss.id, draft: vendorReview, model: 'agent' });
  expect(drafted).toEqual([{ description: 'A quarterly review of the vendor relationship Priya managed.', base: salesWinLoss.id }]);

  expect((await setup(gates, '', { ...vendorReview, base: projectCloseout.id, topics: [] })).status).toBe(400);
  expect((await setup(gates, '', { ...vendorReview, base: 'no-such-template' })).status).toBe(400);
  expect((await setup(gates, '', { ...vendorReview, base: projectCloseout.id, id: projectCloseout.id })).status).toBe(409);
  const approved = await setup(gates, '', { ...vendorReview, base: projectCloseout.id });
  expect(approved.status).toBe(201);
  const identity = await approved.json() as { id: string; version: string; base: string };
  expect(identity).toMatchObject({ id: 'quarterly-vendor-review', base: projectCloseout.id });

  expect((await setup(gates, '/resolve', { id: 'no-such-debrief' })).status).toBe(404);
  const resolved = await (await setup(gates, '/resolve', { id: identity.id })).json() as { id: string; version: string; base: string; draft: unknown };
  expect(resolved).toEqual({ id: identity.id, version: identity.version, base: projectCloseout.id, draft: vendorReview });
  const template = await (await setup(gates, '/resolve', { id: salesWinLoss.id })).json() as { id: string; base: string; draft: { title: string } };
  expect(template).toMatchObject({ id: salesWinLoss.id, base: salesWinLoss.id, draft: { title: 'Sales Win Loss' } });
  expect((await setup(gates, '/elsewhere')).status).toBe(404);
});

test('the interview routes hand setup paths to the debrief routes without an attempt capability, and imported narratives resolve through the catalog', async () => {
  const gates: InterviewGates = {
    available: () => true, limit: async () => true,
    session: async () => { throw new Error('No attempt is involved.'); },
    narrative: async () => new Response('narrative'),
    debriefs: { store: memoryDebriefStore(), catalog: specCatalog(memoryDebriefStore()) },
  };
  const request = (path: string) => new Request(`${origin}/api/interview/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } });
  expect((await routeInterview(request('debriefs/templates'), gates))!.status).toBe(200);
  expect((await routeInterview(request('debriefs/templates'), { ...gates, debriefs: undefined }))!.status).toBe(404);
  expect((await routeInterview(request('sessions'), gates))!.status).toBe(401);
});
