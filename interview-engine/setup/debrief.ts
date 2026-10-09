import { z } from 'zod';
import { interviewDraftSchema, type InterviewPlan } from '../shared/plan';
import type { ResolvedInterview } from '../interview/definition.server';

export type DebriefDraft = Omit<InterviewPlan, 'id' | 'version'>;
export type ApprovedDebrief = DebriefDraft & { id: string; base: string };
// Keep the plan's whole-tree uniqueness refinement on drafts and approvals.
export const debriefDraftSchema = interviewDraftSchema;
export const approvedDebriefSchema = debriefDraftSchema.safeExtend({ id: z.string().trim().min(1).max(100), base: z.string().trim().min(1).max(100) });
export const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
export function templateDraft(spec: ResolvedInterview): DebriefDraft {
  const { id: _id, version: _version, ...draft } = structuredClone(spec.plan);
  return draft;
}
