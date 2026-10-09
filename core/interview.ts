import type * as engine from '../interview-engine/shared/snapshot';
import type { InterviewBackground } from '../interview-engine/shared/snapshot';
import type { Speaker } from '../interview-engine/shared/transcript';
import type { z } from 'zod';
import { interviewReadings, type InterviewReadingId, type interviewSummarySchema } from '../interviews/project-closeout/public';
import { emptyReadings } from '../interview-engine/interview/conversation/coverage';

export { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewReadings, interviewSummarySchema, interviewTopics, interviewVoices, type InterviewReadingId } from '../interviews/project-closeout/public';

export { COVERAGE_LEVELS, type CoverageLevel, type InterviewBackground } from '../interview-engine/shared/snapshot';
/** `probability` is P(explored); `achieved` means explored. */
export type InterviewObjectiveReading = engine.InterviewObjectiveReading<Speaker>;
export type InterviewEvaluation = engine.InterviewEvaluation<InterviewReadingId, Speaker>;
export type InterviewSummary = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export type InterviewSummaryContent = z.infer<typeof interviewSummarySchema>;
export type InterviewSession = { evaluation: InterviewEvaluation | null; summary: InterviewSummary | null; background?: InterviewBackground[] };

export { isBackchannel, yieldsTurn } from '../interview-engine/interview/conversation/turns';
export { COVERAGE_LEVEL_LABELS, coverageConfidence, mergeCoverage } from '../interview-engine/interview/conversation/coverage';

export const emptyInterviewReadings = (): InterviewEvaluation['readings'] => emptyReadings<typeof interviewReadings, Speaker>(interviewReadings);
