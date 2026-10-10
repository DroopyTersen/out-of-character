import type * as engine from '../interview-engine/shared/snapshot';
import type { InterviewBackground } from '../interview-engine/shared/snapshot';
import type { Speaker } from '../interview-engine/shared/transcript';
import type { z } from 'zod';
import { type interviewSummarySchema } from '../interviews/project-closeout/public';

export { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewSummarySchema, interviewTopics, interviewVoices } from '../interviews/project-closeout/public';

export { COVERAGE_LEVELS, type CoverageLevel, type InterviewBackground } from '../interview-engine/shared/snapshot';
/** `probability` is P(explored); `achieved` means explored. */
export type InterviewObjectiveReading = engine.InterviewObjectiveReading<Speaker>;
export type InterviewEvaluation = engine.InterviewEvaluation<Speaker>;
export type InterviewSummary = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export type InterviewSummaryContent = z.infer<typeof interviewSummarySchema>;
export type InterviewSession = { evaluation: InterviewEvaluation | null; summary: InterviewSummary | null; background?: InterviewBackground[] };

export { isBackchannel, yieldsTurn } from '../interview-engine/interview/conversation/turns';
export { COVERAGE_LEVEL_LABELS, coverageConfidence, mergeCoverage } from '../interview-engine/interview/conversation/coverage';
