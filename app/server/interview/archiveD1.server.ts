import type { Archive, InterviewArchiveRow } from '../../../interview-engine/interview/seams.server';
import { SIMULATOR_VERSION } from '../../../core/simulator/types';
import type { ArchiveProvenance } from '../simulator/archive.server';
import { writeInterviewArchive } from './archive.server';

/** What the engine cannot know about where it runs. */
export type ArchiveHost = { model: string; workerId: string | null; workerTag: string | null };

/** The provenance column, with the keys in the order the practice simulator has always written them. */
export function archiveProvenance(row: InterviewArchiveRow, host: ArchiveHost): ArchiveProvenance {
  const { provenance } = row;
  const value: ArchiveProvenance = {
    model: host.model, voice: provenance.voice, rubricVersion: provenance.rubricVersion, simulatorVersion: SIMULATOR_VERSION,
    actorDigest: provenance.actorDigest, openingDigest: provenance.openingDigest, workerId: host.workerId, workerTag: host.workerTag,
    contextualDirector: provenance.producer, connection: provenance.connection,
  };
  if (provenance.narrative) value.interviewSummary = provenance.narrative as NonNullable<ArchiveProvenance['interviewSummary']>;
  return value;
}

/** The Archive seam over the `interview_attempts` table. Errors reach the engine, which logs them and moves on. */
export function d1Archive(db: D1Database, host: ArchiveHost): Archive {
  return {
    write: row => writeInterviewArchive(db, {
      state: row.state, capturedAt: row.capturedAt,
      snapshot: row.snapshot,
      provenance: archiveProvenance(row, host), interventions: row.producerLog,
    }),
  };
}
