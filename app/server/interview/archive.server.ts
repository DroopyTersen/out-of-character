import type { InterviewSession } from '../../../core/interview';
import type { SessionSnapshot } from '../../../core/simulator/types';
import type { ArchiveProvenance } from '../simulator/archive.server';
import { fitRecords, type ProducerLogRecord } from '../../../core/interview-producer';

export type InterviewArchiveWrite = {
  /** The spec the attempt ran under: the archive never assumes one. */
  specId: string;
  specVersion: string;
  state: 'partial' | 'final';
  capturedAt: number;
  snapshot: SessionSnapshot & { interview: InterviewSession };
  provenance: ArchiveProvenance;
  interventions: ProducerLogRecord[];
};

/** D1 rejects a row over 2,000,000 bytes; the margin covers row overhead. */
export const ROW_BYTES = 1_990_000;
const encoder = new TextEncoder();

/** Interview rows stay outside routine simulator transcript exports. */
export async function writeInterviewArchive(db: D1Database, { specId, specVersion, state, capturedAt, snapshot, provenance, interventions }: InterviewArchiveWrite): Promise<void> {
  const summary = snapshot.interview.summary;
  const columns = [
    snapshot.id, snapshot.scenarioId, snapshot.clientId, snapshot.startedAt, capturedAt,
    state === 'final' ? capturedAt : null, state, snapshot.status, snapshot.finalization,
    snapshot.feedbackStatus, snapshot.usageSeconds, snapshot.message,
    JSON.stringify(snapshot.transcript), snapshot.interview.evaluation ? JSON.stringify(snapshot.interview.evaluation) : null,
    summary?.status ?? 'pending', summary?.text ?? null,
    JSON.stringify(provenance), '[]', specId, specVersion,
  ];
  // Producer records take whatever the rest of the row leaves.
  const used = columns.reduce<number>((sum, value) => sum + (typeof value === 'string' ? encoder.encode(value).byteLength : 8), 0);
  columns.push(JSON.stringify(fitRecords(interventions, ROW_BYTES - used)));
  const result = await db.prepare(`
    INSERT INTO interview_attempts (
      id, scenario_id, interviewer_id, started_at, updated_at, ended_at, archive_state,
      session_status, finalization, feedback_status, usage_seconds, message,
      transcript_json, evaluation_json, summary_status, summary_text, provenance_json, cues_json, spec_id, spec_version, interventions_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scenario_id = excluded.scenario_id, interviewer_id = excluded.interviewer_id,
      started_at = excluded.started_at, updated_at = excluded.updated_at,
      ended_at = COALESCE(interview_attempts.ended_at, excluded.ended_at), archive_state = excluded.archive_state,
      session_status = excluded.session_status, finalization = excluded.finalization,
      feedback_status = excluded.feedback_status, usage_seconds = excluded.usage_seconds,
      message = excluded.message, transcript_json = excluded.transcript_json,
      evaluation_json = excluded.evaluation_json, summary_status = excluded.summary_status,
      summary_text = excluded.summary_text, provenance_json = excluded.provenance_json,
      cues_json = excluded.cues_json, spec_id = excluded.spec_id, spec_version = excluded.spec_version,
      interventions_json = excluded.interventions_json
    WHERE (interview_attempts.archive_state = 'partial' OR excluded.archive_state = 'final')
      AND (excluded.updated_at >= interview_attempts.updated_at OR
        (interview_attempts.archive_state = 'partial' AND excluded.archive_state = 'final'))
      AND NOT (interview_attempts.summary_status IN ('ready', 'unavailable') AND excluded.summary_status = 'pending')
  `).bind(...columns).run();
  if (!result.success) throw new Error('Interview archive write failed.');
}
