import { RUBRIC_VERSION } from '../../../ai/simulator/rubric';
import { INTERVIEW_RUBRIC_VERSION } from '../../../ai/interview/rubric';
import { actorBrief, getClient, getScenario, openingInstruction } from '../../../ai/simulator/scenarios.server';
import { SIMULATOR_VERSION, type ClientEnding, type SessionPause, type SessionSnapshot } from '../../../core/simulator/types';
import { LIVE_MODEL } from './live.server';
import type { DirectorSummary, InterventionRecord } from '../../../core/simulator/director';
import type { ProducerSummary } from '../../../core/interview-producer';
import type { ReportArchive, ReportAttempt } from './report';

export async function writeReport(db: D1Database, id: string, report: ReportArchive): Promise<void> {
  const result = await db.prepare('UPDATE simulator_attempts SET report_json = ? WHERE id = ?').bind(JSON.stringify(report), id).run();
  if (!result.success || result.meta.changes !== 1) throw new Error('Simulator report archive write failed.');
}

export type ArchiveProvenance = {
  model: string;
  voice: string;
  rubricVersion: string;
  simulatorVersion: string;
  actorDigest: string;
  openingDigest: string;
  workerId: string | null;
  workerTag: string | null;
  /** The simulator's director, or the interview's producer. */
  contextualDirector: DirectorSummary | ProducerSummary | null;
  interviewSummary?: { model: string; version: string; attempts: ReportAttempt[] };
  /** One entry per provider session, and each connection pause. Provider ids are never archived. */
  connection?: ConnectionLog;
  /** Each walk-out judgment, and the walk-out that ended the attempt. Simulator scenarios only. */
  ending?: { checks: EndingCheck[]; clientEnded: ClientEnding | null };
};
export type EndingCheck = {
  passageId: string; startedAt: number; durationMs: number | null; probability: number | null; evidenceId: string | null;
  outcome: 'pending' | 'ended' | 'open' | 'reopened' | 'stale' | 'aborted' | 'evaluation_timeout' | 'evaluation_error';
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined };
};
/** When a provider session was asked to speak, acknowledged it, was asked again, first spoke, and was given up on. */
export type GreetingLog = { sentAt: number; acknowledgedAt: number | null; retriedAt: number | null; repliedAt: number | null; abandonedAt: number | null };
export type ConnectionLog = {
  segments: { epoch: number; startedAt: number; endedAt: number | null; closeReason: string | null; finalization: 'pending' | 'confirmed' | 'unconfirmed'; usageSeconds: number | null; greeting?: GreetingLog }[];
  pauses: { reason: SessionPause['reason']; pausedAt: number; resumedAt: number | null; durationMs: number }[];
};

export type ArchiveWrite = {
  state: 'partial' | 'final'; capturedAt: number; snapshot: SessionSnapshot; provenance: ArchiveProvenance;
  interventions: InterventionRecord[];
};

export async function archiveProvenance(env: Env, snapshot: SessionSnapshot, contextualDirector: DirectorSummary | ProducerSummary | null): Promise<ArchiveProvenance> {
  const scenario = getScenario(snapshot.scenarioId), client = getClient(snapshot.clientId);
  const digest = async (text: string) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
  };
  const [actorDigest, openingDigest] = await Promise.all([digest(actorBrief(scenario, client)), digest(openingInstruction(scenario, client))]);
  return {
    model: env.AZURE_OPENAI_LIVE_MODEL || LIVE_MODEL, voice: client.voice, rubricVersion: snapshot.interview ? INTERVIEW_RUBRIC_VERSION : RUBRIC_VERSION, simulatorVersion: SIMULATOR_VERSION,
    actorDigest, openingDigest, workerId: env.CF_VERSION_METADATA?.id ?? null, workerTag: env.CF_VERSION_METADATA?.tag ?? null,
    contextualDirector,
  };
}

/** SessionSnapshot is the public projection built by the session owner, not raw provider output. */
export async function writeArchive(db: D1Database, value: ArchiveWrite): Promise<void> {
  const { snapshot, capturedAt, state, provenance } = value;
  const columns = [
    snapshot.id, snapshot.scenarioId, snapshot.clientId, snapshot.startedAt, capturedAt,
    state === 'final' ? capturedAt : null, state, snapshot.status, snapshot.finalization,
    snapshot.feedbackStatus, snapshot.usageSeconds, snapshot.message,
    JSON.stringify(snapshot.transcript), snapshot.evaluation ? JSON.stringify(snapshot.evaluation) : null,
    JSON.stringify(provenance), '[]', JSON.stringify(value.interventions),
  ];
  const result = await db.prepare(`
    INSERT INTO simulator_attempts (
      id, scenario_id, client_id, started_at, updated_at, ended_at, archive_state,
      session_status, finalization, feedback_status, usage_seconds, message,
      transcript_json, evaluation_json, provenance_json, cues_json, interventions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scenario_id = excluded.scenario_id, client_id = excluded.client_id,
      started_at = excluded.started_at, updated_at = excluded.updated_at,
      ended_at = excluded.ended_at, archive_state = excluded.archive_state,
      session_status = excluded.session_status, finalization = excluded.finalization,
      feedback_status = excluded.feedback_status, usage_seconds = excluded.usage_seconds,
      message = excluded.message, transcript_json = excluded.transcript_json,
      evaluation_json = excluded.evaluation_json, provenance_json = excluded.provenance_json,
      interventions_json = excluded.interventions_json
    WHERE excluded.archive_state = 'final' OR (
      simulator_attempts.archive_state = 'partial' AND excluded.updated_at >= simulator_attempts.updated_at
    )
  `).bind(...columns).run();
  if (!result.success) throw new Error('Simulator archive write failed.');
}
