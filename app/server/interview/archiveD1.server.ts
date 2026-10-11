import type { Archive, InterviewArchiveRow } from '../../../interview-engine/seams.server';
import { SIMULATOR_VERSION } from '../../../core/simulator/types';
import type { ArchiveProvenance } from '../simulator/archive.server';
import type { NarrativeStatus, NarrativeProvenance } from '../../reports/report.types';
import { writeInterviewArchive } from './archive.server';

/** What the engine cannot know about where it runs. */
export type ArchiveHost = { model: string; workerId: string | null; workerTag: string | null };

/** The provenance column, with the keys in the order the practice simulator has always written them. */
export function archiveProvenance(row: InterviewArchiveRow, host: ArchiveHost): ArchiveProvenance {
  const { provenance } = row;
  const value: ArchiveProvenance = {
    model: host.model, voice: provenance.voice, rubricVersion: provenance.rubricVersion, simulatorVersion: SIMULATOR_VERSION,
    brief: provenance.brief, opening: provenance.opening, models: provenance.models, passageTimings: provenance.passageTimings, media: provenance.media,
    actorDigest: provenance.actorDigest, openingDigest: provenance.openingDigest, workerId: host.workerId, workerTag: host.workerTag,
    contextualDirector: provenance.producer, connection: provenance.connection,
  };
  return value;
}

/** The host retains each captured row so report persistence never asks the engine to archive again. */
export function d1Archive(db: D1Database, host: ArchiveHost): Archive & {
  writeReport(id: string, status: NarrativeStatus, provenance: NarrativeProvenance): Promise<void>;
} {
  const captured = new Map<string, InterviewArchiveRow>();
  const write = (row: InterviewArchiveRow, report?: { status: NarrativeStatus; provenance: NarrativeProvenance }) => {
    return writeInterviewArchive(db, {
      specId: row.specId, specVersion: row.specVersion, state: row.state, capturedAt: row.capturedAt,
      snapshot: row.snapshot, ...(report ? { narrative: report.status } : {}),
      provenance: { ...archiveProvenance(row, host), ...(report ? { interviewSummary: report.provenance } : {}) },
      interventions: row.producerLog,
    });
  };
  return {
    async write(row) {
      if (row.state === 'final') captured.set(row.id, structuredClone(row));
      await write(row);
    },
    async writeReport(id, status, provenance) {
      const row = captured.get(id);
      if (!row || row.state !== 'final') throw new Error('End the interview before saving its report.');
      await write(row, { status, provenance });
    },
  };
}
