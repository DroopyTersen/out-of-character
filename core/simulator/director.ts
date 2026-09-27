import type { LiveHint } from './types';

export type DirectorAudience = 'trainee' | 'actor';
export const ACTOR_CONDITIONS = ['knowledge', 'authority', 'role', 'interests', 'temperament', 'assertiveness', 'style'] as const;
export type BooleanCondition = 'mistake' | 'stalled' | (typeof ACTOR_CONDITIONS)[number];
export type DirectorSignal = { condition: BooleanCondition; probability: number } | { condition: `objective:${string}`; selected: boolean };
export type DirectorCondition = DirectorSignal['condition'];
export const DIRECTOR_VERSION = 'contextual-director-v2';
export const DIRECTOR_LIMITS = { calls: { trainee: 40, actor: 20 }, rechecks: 60, notes: 6, cooldown: 20_000, reconsider: 60_000, age: 20_000, generation: 15_000, recheck: 3000, hint: 30_000 };
export const MATERIAL_CONCERN = 'A commitment or claim may go beyond what has been established. Review it before proceeding.';

export type DirectorIssue = { signal: DirectorSignal; id: string; active: boolean; lastReview: number | null; reviewedRevision: number };
type Lane = { busy: boolean; lastStart: number | null; issues: Map<DirectorCondition, DirectorIssue>; current: DirectorCondition[] };
const lane = (): Lane => ({ busy: false, lastStart: null, issues: new Map(), current: [] });
const valid = (signal: DirectorSignal) => 'selected' in signal || (Number.isFinite(signal.probability) && signal.probability >= 0 && signal.probability <= 1);
// Actor signals request a second opinion; Sol still decides whether to intervene.
const eligible = (signal: DirectorSignal) => 'selected' in signal ? signal.selected : valid(signal) && signal.probability >= (signal.condition === 'mistake' ? .85 : signal.condition === 'stalled' ? .8 : .6);
const probability = (signal: DirectorSignal) => 'probability' in signal ? signal.probability : 0;
const prioritized = (audience: DirectorAudience, signals: DirectorSignal[]) => audience === 'actor' ? [...signals].sort((a, b) => probability(b) - probability(a)) : signals;
export const selectDirectorSignal = (signals: DirectorSignal[], audience: DirectorAudience) => prioritized(audience, signals).find(eligible);
export type GateSkip = 'busy' | 'budget' | 'note_cap' | 'cooldown' | 'no_trigger' | 'waiting_for_progress';
export type GateReview = { decision: 'started'; issueId: string; work: Promise<void> } | { decision: GateSkip; issueId?: never; work?: never };

/** Owns admission, accounting and slot release for optional director work. */
export class DirectorGate {
  private lanes = { trainee: lane(), actor: lane() };
  private counts = { calls: { trainee: 0, actor: 0 }, rechecks: 0, notes: 0 };
  private episode = 0;

  get usage() { return { callsByAudience: { ...this.counts.calls }, rechecks: this.counts.rechecks, notes: this.counts.notes }; }
  hasCapacity(audience: DirectorAudience) {
    return this.counts.calls[audience] < DIRECTOR_LIMITS.calls[audience] && (audience === 'trainee' || this.counts.notes < DIRECTOR_LIMITS.notes);
  }

  observe(audience: DirectorAudience, signals: DirectorSignal[]) {
    const state = this.lanes[audience];
    state.current = [];
    for (const signal of prioritized(audience, signals)) {
      if (!valid(signal)) continue;
      state.current.push(signal.condition);
      let issue = state.issues.get(signal.condition);
      const objective = 'selected' in signal;
      const resolved = objective ? !signal.selected : signal.probability < .5;
      if (resolved) {
        if (issue) { issue.active = false; issue.signal = signal; }
        continue;
      }
      if ((!issue || !issue.active) && eligible(signal)) {
        if (!issue || !objective) {
          issue = { signal, id: objective ? `hint:${signal.condition}` : `${audience}:${signal.condition}:${++this.episode}`, active: true, lastReview: null, reviewedRevision: -1 };
          state.issues.set(signal.condition, issue);
        } else issue.active = true;
      }
      if (issue) issue.signal = signal;
    }
  }

  review(audience: DirectorAudience, now: number, revision: number, work: (issue: DirectorIssue) => Promise<void>): GateReview {
    const state = this.lanes[audience];
    if (state.busy) return { decision: 'busy' };
    if (this.counts.calls[audience] >= DIRECTOR_LIMITS.calls[audience]) return { decision: 'budget' };
    if (audience === 'actor' && this.counts.notes >= DIRECTOR_LIMITS.notes) return { decision: 'note_cap' };
    if (state.lastStart !== null && now - state.lastStart < DIRECTOR_LIMITS.cooldown) return { decision: 'cooldown' };
    // Inputs are ordered by priority. A material concern owns the trainee slot.
    const conditions: DirectorCondition[] = audience === 'trainee' && this.concern() ? ['mistake'] : state.current;
    const candidates = conditions.map(condition => state.issues.get(condition)).filter((issue): issue is DirectorIssue => !!issue?.active && eligible(issue.signal));
    if (!candidates.length) return { decision: 'no_trigger' };
    const issue = candidates.find(issue => issue.lastReview === null || (now - issue.lastReview >= DIRECTOR_LIMITS.reconsider && revision > issue.reviewedRevision));
    if (!issue) return { decision: 'waiting_for_progress' };
    state.busy = true;
    state.lastStart = now;
    issue.lastReview = now;
    issue.reviewedRevision = revision;
    this.counts.calls[audience]++;
    // The gate releases its own slot even if work throws synchronously.
    return { decision: 'started', issueId: issue.id, work: (async () => { try { await work({ ...issue }); } finally { state.busy = false; } })() };
  }

  recheck<T>(work: () => Promise<T>): Promise<T> | undefined {
    if (this.counts.rechecks >= DIRECTOR_LIMITS.rechecks) return;
    this.counts.rechecks++;
    return work();
  }

  sendNote(send: () => boolean): boolean {
    if (this.counts.notes >= DIRECTOR_LIMITS.notes || !send()) return false;
    this.counts.notes++;
    return true;
  }

  current(audience: DirectorAudience, id: string): boolean {
    const state = this.lanes[audience];
    return state.current.some(condition => { const issue = state.issues.get(condition); return issue?.id === id && issue.active; });
  }

  concern(): DirectorIssue | undefined {
    const issue = this.lanes.trainee.issues.get('mistake');
    return issue?.active ? { ...issue } : undefined;
  }
}

export type DirectorUsage = { inputTokens: number | null; outputTokens: number | null; cachedTokens?: number | null };
export type DirectorResult = { action: 'none'; text: null; evidenceIds: [] } | { action: 'intervene'; text: string; evidenceIds: string[] };
type RecordBase = {
  id: string; observationId: string; issueId: string; audience: DirectorAudience; signal: DirectorSignal;
  revision: number; snapshotAt: number; gateAt: number; model: string;
};
export type DetectorRecord = RecordBase & {
  source: 'detector'; result: Extract<DirectorResult, { action: 'intervene' }>; outcome: 'published'; readyAt: number; deliveredAt: number;
};
export type DirectorRecord = RecordBase & {
  source: 'director'; effort: 'none'; inputCount: number; lastInputId: string | null; result?: DirectorResult; readyAt?: number; deliveredAt?: number; completedAt?: number;
  outcome: 'pending' | 'published' | 'sent' | 'none' | 'stale' | 'invalid' | 'timeout' | 'error' | 'aborted';
  usage?: DirectorUsage; recheck?: { inputCount: number; lastInputId: string | null; startedAt: number; probability: number | null; durationMs: number | null; usage?: DirectorUsage };
  delivery?: { eventId: string; afterPassageId: string | null; status: 'unknown' | 'accepted' | 'rejected'; acknowledgedAt?: number };
};
export type ObservationRecord = {
  source: 'observation'; id: string; audience: DirectorAudience; revision: number; snapshotAt: number; completedAt?: number;
  model: string; signals: DirectorSignal[]; inputCount: number; lastInputId: string | null;
  outcome: GateReview['decision'] | 'pending' | 'aborted' | 'stale' | 'expired' | 'evaluation_error' | 'evaluation_timeout'; issueId?: string;
};
export type InterventionRecord = ObservationRecord | DetectorRecord | DirectorRecord;
export type DirectorSummary = { model: string; effort: 'none'; version: string; callsByAudience: Record<DirectorAudience, number>; rechecks: number; notes: number };

export const publicHint = (issue: DirectorIssue, text: string, evidenceIds: string[], now: number): LiveHint => ({
  id: issue.id, text, kind: issue.signal.condition === 'mistake' ? 'concern' : 'hint', evidenceIds, createdAt: now, expiresAt: now + DIRECTOR_LIMITS.hint,
  objectiveId: 'selected' in issue.signal ? issue.signal.condition.slice('objective:'.length) : null,
});
