import type { ResolvedInterview } from '../../../interview-engine/interview/definition.server';
import { foundryConfig, foundryConfigured } from '../../../ai/foundry.server';
import { foundryProviders } from '../../../interview-engine/providers/providers.server';
import { approveDebrief, approvedId } from '../../../interview-engine/setup/approve.server';
import { approvedDebriefSchema, debriefDraftSchema, templateDraft, type ApprovedDebrief, type DebriefDraft } from '../../../interview-engine/setup/debrief';
import { draftDebrief, type DraftResult } from '../../../interview-engine/setup/draft.server';
import { spec as projectCloseout } from '../../../interviews/project-closeout/spec';
import { spec as salesWinLoss } from '../../../interviews/sales-win-loss/spec';
import { z } from 'zod';
import { BodyError, boundedJson } from '../http';
import { simulatorJson } from '../simulator/api';

/** A spec this host can run: briefed, judged and mapped for the session, with a narrative that writes a text document. */
export type HostedSpec = ResolvedInterview;

/** The debriefs a host ships as code: each is a template an organizer can run as is, edit, or base an ad hoc debrief on. */
export const templates: readonly HostedSpec[] = [projectCloseout, salesWinLoss];

/** An approved debrief as stored: its identity, the template it is based on, and the record the spec is built from. */
export type StoredDebrief = { id: string; version: string; base: string; approvedAt: number; record: ApprovedDebrief };

/** Where approved debriefs live. `get` without a version returns the most recently approved. */
export type DebriefStore = {
  get(id: string, version?: string): Promise<StoredDebrief | null>;
  put(debrief: StoredDebrief): Promise<void>;
};

/** The store over the `debrief_specs` table. */
export function d1DebriefStore(db: D1Database): DebriefStore {
  type Row = { id: string; version: string; base: string; approved_at: number; record_json: string };
  return {
    async get(id, version) {
      const row = version
        ? await db.prepare('SELECT * FROM debrief_specs WHERE id = ? AND version = ?').bind(id, version).first<Row>()
        : await db.prepare('SELECT * FROM debrief_specs WHERE id = ? ORDER BY approved_at DESC LIMIT 1').bind(id).first<Row>();
      return row ? { id: row.id, version: row.version, base: row.base, approvedAt: row.approved_at, record: JSON.parse(row.record_json) as ApprovedDebrief } : null;
    },
    async put(debrief) {
      const result = await db.prepare('INSERT INTO debrief_specs (id, version, base, approved_at, record_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id, version) DO NOTHING')
        .bind(debrief.id, debrief.version, debrief.base, debrief.approvedAt, JSON.stringify(debrief.record)).run();
      if (!result.success) throw new Error('Debrief store write failed.');
    },
  };
}

/** The store in memory, for the reference host and tests. */
export function memoryDebriefStore(): DebriefStore & { rows: StoredDebrief[] } {
  const rows: StoredDebrief[] = [];
  return {
    rows,
    async get(id, version) { return [...rows].reverse().find(row => row.id === id && (!version || row.version === version)) ?? null; },
    async put(debrief) { if (!rows.some(row => row.id === debrief.id && row.version === debrief.version)) rows.push(structuredClone(debrief)); },
  };
}

/**
 * Every spec a host can run: its templates by id, and approved debriefs rebuilt from their records on their base
 * template. An attempt resolves its spec by id at start and by id and version thereafter, so a debrief approved again
 * under the same id never changes a running attempt.
 */
export type SpecCatalog = {
  templates: readonly HostedSpec[];
  resolve(id: string, version?: string): Promise<HostedSpec | null>;
};

export function specCatalog(store: DebriefStore, specs: readonly HostedSpec[] = templates): SpecCatalog {
  const template = (id: string) => specs.find(spec => spec.id === id);
  return {
    templates: specs,
    async resolve(id, version) {
      const shipped = template(id);
      if (shipped) return !version || shipped.version === version ? shipped : null;
      const stored = await store.get(id, version);
      const base = stored && template(stored.base);
      return stored && base ? approveDebrief(base, stored.record) : null;
    },
  };
}

/** What a host supplies to the debrief setup routes. `draft` is absent when no language model is configured. */
export type DebriefGates = {
  store: DebriefStore;
  catalog: SpecCatalog;
  draft?(input: { description: string; base: HostedSpec }, signal: AbortSignal): Promise<DraftResult>;
};

/** The Worker's debrief setup: approved debriefs in D1, drafts from the agent model. */
export function workerDebriefs(env: Env): DebriefGates {
  const store = d1DebriefStore(env.SIMULATOR_ARCHIVE);
  return {
    store, catalog: specCatalog(store),
    ...(foundryConfigured(env) ? { draft: (input: { description: string; base: HostedSpec }, signal: AbortSignal) =>
      draftDebrief({ description: input.description, interviewer: { name: input.base.interviewer.name }, model: foundryProviders(foundryConfig(env)).language.agent, signal }) } : {}),
  };
}

const draftRequestSchema = z.object({ description: z.string().trim().min(20).max(8000), base: z.string().optional() }).strict();
const approveRequestSchema = debriefDraftSchema.safeExtend({ id: approvedDebriefSchema.shape.id.optional(), base: approvedDebriefSchema.shape.base });
const resolveRequestSchema = z.object({ id: z.string().min(1).max(100), version: z.string().min(1).max(200).optional() }).strict();
const SETUP_BODY_LIMIT = 256 * 1024;

/** The editable draft inside an approved record. */
const recordDraft = ({ id: _id, base: _base, ...draft }: ApprovedDebrief): DebriefDraft => draft;

/** A debrief as the setup routes return it: its identity and the editable draft. */
const describe = (spec: HostedSpec, base: string, draft: DebriefDraft) => ({ id: spec.id, version: spec.version, base, draft });

/**
 * `/api/interview/debriefs/...`: how an organizer sets a debrief up before any attempt exists. `templates` lists the
 * shipped debriefs as editable drafts; `drafts` has the agent model draft one from a description; a POST to the root
 * approves a draft and returns the id and version an attempt starts under; `resolve` reads an approved debrief back.
 * Same origin and the host's paid-service gates apply; no attempt capability does, since there is no attempt yet.
 */
export async function routeDebriefs(request: Request, url: URL, gates: DebriefGates | undefined, paid: { available(): boolean; limit(key: string): Promise<boolean> }): Promise<Response> {
  if (!gates) return simulatorJson({ error: 'Unknown interview route.' }, 404);
  if (request.method !== 'POST') return simulatorJson({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') !== url.origin) return simulatorJson({ error: 'Same-origin requests are required.' }, 403);
  const { catalog, store } = gates;
  const base = (id: string | undefined) => catalog.templates.find(spec => spec.id === (id ?? catalog.templates[0]!.id));
  try {
    switch (url.pathname) {
      case '/api/interview/debriefs/templates':
        return simulatorJson({ templates: catalog.templates.map(spec => describe(spec, spec.id, templateDraft(spec))) });
      case '/api/interview/debriefs/drafts': {
        if (!gates.draft || !paid.available()) return simulatorJson({ error: 'Debrief drafting is currently unavailable.' }, 503);
        if (!(await paid.limit(`draft:${request.headers.get('CF-Connecting-IP') || 'local'}`))) return simulatorJson({ error: 'Please wait a minute before drafting another debrief.' }, 429);
        const parsed = draftRequestSchema.safeParse(await boundedJson(request, SETUP_BODY_LIMIT));
        const from = parsed.success ? base(parsed.data.base) : undefined;
        if (!parsed.success || !from) return simulatorJson({ error: 'Invalid debrief description.' }, 400);
        const result = await gates.draft({ description: parsed.data.description, base: from }, request.signal);
        return simulatorJson({ base: from.id, draft: result.draft, model: result.model });
      }
      case '/api/interview/debriefs': {
        const parsed = approveRequestSchema.safeParse(await boundedJson(request, SETUP_BODY_LIMIT));
        const from = parsed.success ? base(parsed.data.base) : undefined;
        if (!parsed.success || !from) return simulatorJson({ error: parsed.success ? 'Unknown base debrief.' : 'Invalid debrief.' }, 400);
        const id = approvedId(parsed.data);
        if (catalog.templates.some(spec => spec.id === id)) return simulatorJson({ error: 'That id belongs to a shipped debrief; choose another.' }, 409);
        const record = { ...parsed.data, id, base: from.id };
        const spec = await approveDebrief(from, record).catch(() => null);
        if (!spec) return simulatorJson({ error: 'Invalid debrief.' }, 400);
        await store.put({ id: spec.id, version: spec.version, base: from.id, approvedAt: Date.now(), record });
        return simulatorJson({ id: spec.id, version: spec.version, base: from.id }, 201);
      }
      case '/api/interview/debriefs/resolve': {
        const parsed = resolveRequestSchema.safeParse(await boundedJson(request, 4096));
        if (!parsed.success) return simulatorJson({ error: 'Invalid interview request.' }, 400);
        const spec = await catalog.resolve(parsed.data.id, parsed.data.version);
        if (!spec) return simulatorJson({ error: 'Unknown debrief.' }, 404);
        const stored = catalog.templates.includes(spec) ? null : await store.get(parsed.data.id, parsed.data.version);
        return simulatorJson(describe(spec, stored?.base ?? spec.id, stored ? recordDraft(stored.record) : templateDraft(spec)));
      }
      default:
        return simulatorJson({ error: 'Unknown interview route.' }, 404);
    }
  } catch (error) {
    if (error instanceof BodyError) return simulatorJson({ error: error.message }, error.status);
    console.warn('Debrief setup failed', error);
    return simulatorJson({ error: 'Debrief setup is unavailable. Please try again.' }, 502);
  }
}
