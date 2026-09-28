import { z } from 'zod';
import { findEvidence } from './state';
import { skills, type SkillId, type SessionSnapshot, type FeedbackAssessment } from './types';

export const REPORT_MAX_STARTS = 2;
export const REPORT_DEADLINE_MS = 120_000;
export const reportEvidenceSchema = z.array(z.string()).max(2);
export const reportSkillSchema = z.strictObject({ score: z.number().min(0).max(4).nullable(), evidenceIds: reportEvidenceSchema });
export const reportObjectiveSchema = z.strictObject({ achieved: z.boolean(), evidenceIds: reportEvidenceSchema });
const pointSchema = z.strictObject({ text: z.string().min(1).max(700), evidenceIds: reportEvidenceSchema.min(1) });
export const reportSchema = z.strictObject({
  evaluation: z.strictObject({
    skills: z.strictObject(Object.fromEntries(skills.map(({ id }) => [id, reportSkillSchema])) as Record<SkillId, typeof reportSkillSchema>),
    objectives: z.record(z.string(), reportObjectiveSchema),
  }),
  overview: z.string().min(1).max(900),
  strengths: z.array(pointSchema).max(2),
  improvements: z.array(pointSchema.extend({ alternative: z.string().min(1).max(400).nullable() })).max(2),
  nextPractice: z.string().min(1).max(400),
});
export type CoachingReport = z.infer<typeof reportSchema>;
export type ReportFailure = 'provider' | 'invalid' | 'cancelled' | 'timeout';
export type ReportState = { starts: number } & (
  | { status: 'idle' | 'running'; report: null; failure: null }
  | { status: 'completed'; report: CoachingReport; failure: null }
  | { status: 'failed'; report: null; failure: ReportFailure }
  | { status: 'ineligible' | 'unavailable'; report: null; failure: null }
);
export const idleReport = (): ReportState => ({ status: 'idle', starts: 0, report: null, failure: null });

/** Adapt final judgments to the existing evidence/score components without mutating Jev's readings. */
export function reportEvaluation(report: CoachingReport, snapshot: SessionSnapshot): FeedbackAssessment {
  return {
    skills: Object.fromEntries(skills.map(({ id }) => [id, {
      value: report.evaluation.skills[id].score,
      evidence: findEvidence(snapshot.transcript, report.evaluation.skills[id].evidenceIds[0] ?? ''),
    }])) as FeedbackAssessment['skills'],
    objectives: Object.entries(report.evaluation.objectives).map(([id, reading]) => ({
      id, achieved: reading.achieved,
      evidence: findEvidence(snapshot.transcript, reading.evidenceIds[0] ?? ''),
    })),
  };
}
