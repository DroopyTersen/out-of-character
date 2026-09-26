import { skills, type Evidence, type SessionSnapshot } from '../../../core/simulator/types';
import type { SentCue } from '../../../core/simulator/state';

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

function evidence(value: Evidence | null) {
  return value && { entryId: value.entryId, speaker: value.speaker, text: value.text };
}

function evaluation(snapshot: SessionSnapshot) {
  const value = snapshot.evaluation;
  if (!value) return null;
  return {
    revision: value.revision,
    skills: Object.fromEntries(skills.map(({ id }) => {
      const reading = value.skills[id];
      return [id, {
        value: reading.value,
        distribution: reading.distribution && Object.fromEntries(Object.entries(reading.distribution).filter(([, score]) => typeof score === 'number')),
        evidence: evidence(reading.evidence),
      }];
    })),
    objectives: value.objectives.map(item => ({
      id: item.id, probability: item.probability, achieved: item.achieved, evidence: evidence(item.evidence),
    })),
    hint: value.hint,
    hintId: value.hintId ?? null,
    concern: value.concern,
    model: value.model,
    durationMs: value.durationMs,
  };
}

/** The archive stores only the public session projection and selected provenance. */
export async function writeArchive(db: D1Database, value: ArchiveWrite): Promise<void> {
  const { snapshot, capturedAt, state, provenance, cues } = value;
  const transcript = snapshot.transcript.map(item => ({
    id: item.id, speaker: item.speaker, text: item.text, startMs: item.startMs, endMs: item.endMs,
  }));
  const source = {
    model: provenance.model,
    voice: provenance.voice,
    rubricVersion: provenance.rubricVersion,
    simulatorVersion: provenance.simulatorVersion,
    actorDigest: provenance.actorDigest,
    openingDigest: provenance.openingDigest,
    workerId: provenance.workerId,
    workerTag: provenance.workerTag,
    directorEnabled: provenance.directorEnabled,
  };
  const sentCues = cues.map(cue => ({ id: cue.id, revision: cue.revision, sentAt: cue.sentAt }));
  const score = evaluation(snapshot);
  const columns = [
    snapshot.id, snapshot.scenarioId, snapshot.clientId, snapshot.startedAt, capturedAt,
    state === 'final' ? capturedAt : null, state, snapshot.status, snapshot.finalization,
    snapshot.feedbackStatus, snapshot.usageSeconds, snapshot.message,
    JSON.stringify(transcript), score ? JSON.stringify(score) : null, JSON.stringify(source), JSON.stringify(sentCues),
  ];
  const guard = state === 'partial'
    ? "WHERE simulator_attempts.archive_state = 'partial' AND excluded.updated_at >= simulator_attempts.updated_at"
    : '';
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
    ${guard}
  `).bind(...columns).run();
  if (!result.success) throw new Error('Simulator archive write failed.');
}
