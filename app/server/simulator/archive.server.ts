import { RUBRIC_VERSION } from '../../../ai/simulator/rubric';
import { actorBrief, getClient, getScenario, openingInstruction } from '../../../ai/simulator/scenarios.server';
import { SIMULATOR_VERSION, type SessionSnapshot } from '../../../core/simulator/types';
import type { SentCue } from '../../../core/simulator/state';
import { LIVE_MODEL } from './live.server';

export type ArchiveProvenance = {
  model: string;
  voice: string;
  rubricVersion: string;
  simulatorVersion: string;
  actorDigest: string;
  openingDigest: string;
  workerId: string | null;
  workerTag: string | null;
  directorEnabled: boolean;
};

export type ArchiveWrite = {
  state: 'partial' | 'final'; capturedAt: number; snapshot: SessionSnapshot; provenance: ArchiveProvenance; cues: SentCue[];
};

export async function archiveProvenance(env: Env, snapshot: SessionSnapshot): Promise<ArchiveProvenance> {
  const scenario = getScenario(snapshot.scenarioId), client = getClient(snapshot.clientId);
  const digest = async (text: string) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
  };
  const [actorDigest, openingDigest] = await Promise.all([digest(actorBrief(scenario, client)), digest(openingInstruction(scenario, client))]);
  return {
    model: LIVE_MODEL, voice: snapshot.voice ?? client.voice, rubricVersion: RUBRIC_VERSION, simulatorVersion: SIMULATOR_VERSION,
    actorDigest, openingDigest, workerId: env.CF_VERSION_METADATA?.id ?? null, workerTag: env.CF_VERSION_METADATA?.tag ?? null,
    directorEnabled: env.SIMULATOR_DIRECTOR_ENABLED === 'true',
  };
}

/** SessionSnapshot is the public projection built by the session owner, not raw provider output. */
export async function writeArchive(db: D1Database, value: ArchiveWrite): Promise<void> {
  const { snapshot, capturedAt, state, provenance, cues } = value;
  const columns = [
    snapshot.id, snapshot.scenarioId, snapshot.clientId, snapshot.startedAt, capturedAt,
    state === 'final' ? capturedAt : null, state, snapshot.status, snapshot.finalization,
    snapshot.feedbackStatus, snapshot.usageSeconds, snapshot.message,
    JSON.stringify(snapshot.transcript), snapshot.evaluation ? JSON.stringify(snapshot.evaluation) : null,
    JSON.stringify(provenance), JSON.stringify(cues),
  ];
  const result = await db.prepare(`
    INSERT INTO simulator_attempts (
      id, scenario_id, client_id, started_at, updated_at, ended_at, archive_state,
      session_status, finalization, feedback_status, usage_seconds, message,
      transcript_json, evaluation_json, provenance_json, cues_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scenario_id = excluded.scenario_id, client_id = excluded.client_id,
      started_at = excluded.started_at, updated_at = excluded.updated_at,
      ended_at = excluded.ended_at, archive_state = excluded.archive_state,
      session_status = excluded.session_status, finalization = excluded.finalization,
      feedback_status = excluded.feedback_status, usage_seconds = excluded.usage_seconds,
      message = excluded.message, transcript_json = excluded.transcript_json,
      evaluation_json = excluded.evaluation_json, provenance_json = excluded.provenance_json,
      cues_json = excluded.cues_json
    WHERE excluded.archive_state = 'final' OR (
      simulator_attempts.archive_state = 'partial' AND excluded.updated_at >= simulator_attempts.updated_at
    )
  `).bind(...columns).run();
  if (!result.success) throw new Error('Simulator archive write failed.');
}
