import type * as engine from '../interview-engine/shared/snapshot';
import type { CoverageLevel, InterviewBackground } from '../interview-engine/shared/snapshot';
import type { Speaker } from './simulator/types';
import type { z } from 'zod';
import { interviewReadings, type InterviewReadingId, type interviewSummarySchema } from '../interviews/project-closeout/public';

export { INTERVIEW_SCENARIO_ID, INTERVIEWER_NAME, interviewReadings, interviewSummarySchema, interviewTopics, interviewVoices, type InterviewReadingId } from '../interviews/project-closeout/public';

export { COVERAGE_LEVELS, type CoverageLevel, type InterviewBackground } from '../interview-engine/shared/snapshot';
/** `probability` is P(explored); `achieved` means explored. */
export type InterviewObjectiveReading = engine.InterviewObjectiveReading<Speaker>;
export type InterviewEvaluation = engine.InterviewEvaluation<InterviewReadingId, Speaker>;
export type InterviewSummary = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export type InterviewSummaryContent = z.infer<typeof interviewSummarySchema>;
export type InterviewSession = { evaluation: InterviewEvaluation | null; summary: InterviewSummary | null; background?: InterviewBackground[] };

const BACKCHANNEL = /^(?:mm+(?:[- ]?hm*)?|hmm+|uh[- ]?huh|ah+|oh+|['’]?kay|yeah|yep|yes|no|right|okay|ok|sure)[.!?]*$/i;
export const isBackchannel = (text: string) => BACKCHANNEL.test(text.trim());

const YIELD = /\b(?:go on|go ahead|keep going|carry on|please continue|i['’]m listening|sorry|after you|you go|i thought you were (?:done|finished))\b/i;
/**
 * Whether Sam's passage hands the floor back rather than taking a turn: a backchannel, a few words that aren't a question,
 * or an apology or go-ahead. The voice model often starts into a pause and stops ("Oh,", "I mean,", "Sorry, go ahead."),
 * and the participant's next words carry on the same turn.
 */
export function yieldsTurn(text: string): boolean {
  const words = text.replace(/\[[^\]]*\]/g, ' ').replace(/[\s,;:\-–—…]+$/u, '').trim();
  if (!words || isBackchannel(words)) return true;
  if (words.endsWith('?')) return false;
  const count = words.split(/\s+/).length;
  return count <= 6 || (count <= 12 && YIELD.test(words));
}

/** The participant's words without transcribed noises such as "[sniff]" or "tongue click". */
export const spokenWords = (text: string) => text.replace(/\[[^\]]*(?:\]|$)/g, ' ').replace(/\btongue click\b/gi, ' ').replace(/\s+/g, ' ').trim();
const THINKING = /^(?:hmm+|um+|uh+|er+|mm+)[.!?,…]*$/i;
const UNFINISHED = /(?:\b(?:and|but|so|because|or|like|um+|uh+|er+|the|a|an|to|of|for|with|that|which|if|when|then|kind of|sort of)|[,;:…]|\.\.\.|[-–—])$/i;
const HOLDING = /\b(?:let me (?:think|see|check|find|look)|hold on|hang on|give me a (?:sec(?:ond)?|minute|moment)|one sec(?:ond)?|just a (?:sec(?:ond)?|moment|minute))\b/i;
/** Whether the participant's latest words read as a finished turn: not a thinking sound, a clause left hanging, or a request for time. */
export function finishesTurn(text: string): boolean {
  const words = spokenWords(text);
  return !!words && !THINKING.test(words) && !UNFINISHED.test(words) && !HOLDING.test(words);
}

const ENDING = /\b(?:(?:can|could) we (?:be done|stop|wrap|end|finish)|let['’]?s (?:stop|wrap|end|finish|be done|call it)|(?:i|we) (?:need|have|got) to (?:go|run|stop)|gotta go|i['’]m done|we['’]re done|stop here|wrap (?:it |this )?up|end (?:the|this) (?:interview|call|conversation))\b/i;
/** Whether the participant asks to finish the interview. */
export const asksToEnd = (text: string) => ENDING.test(spokenWords(text));

/**
 * Live coverage is re-judged every grade. A current explored or set-aside reading wins;
 * otherwise a prior band holds while the current reading still gives it at least even odds,
 * so a topic neither flickers nor stays credited once the evidence stops supporting it.
 * Touched only means the topic came up, so its odds are P(it came up at all) = 1 − P(not yet):
 * mass moving toward explored without evidence does not drop it to not yet.
 * A declined topic stays closed until a supported answer reopens it; the final grade is independent.
 */
export function mergeCoverage(previous: InterviewObjectiveReading[], current: InterviewObjectiveReading[]): InterviewObjectiveReading[] {
  return current.map(reading => {
    const prior = previous.find(item => item.id === reading.id);
    if (reading.level === 'explored' || reading.level === 'set-aside' || !prior || prior.level === 'not-yet' || !prior.evidence) return reading;
    // Retain the boundary and the confidence of its supporting judgment; raw new odds stay in diagnostics.
    if (prior.level === 'set-aside') return prior;
    if (!reading.levels) return reading;
    const odds = prior.level === 'touched' ? 1 - reading.levels['not-yet'] : reading.levels[prior.level];
    if (odds < .5) return reading;
    return { ...reading, level: prior.level, achieved: prior.level === 'explored', evidence: prior.evidence };
  });
}


export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = { 'not-yet': 'Not yet', touched: 'Touched on', explored: 'Explored', 'set-aside': 'Set aside' };

/**
 * P(explored) for explored, P(set aside) for set aside, and P(it has come up at all)
 * for touched. The latter is not confidence in its exact depth. Not yet shows none.
 */
export function coverageConfidence(reading: Pick<InterviewObjectiveReading, 'level' | 'levels'> | undefined): number | null {
  if (!reading?.levels || reading.level === 'not-yet') return null;
  return reading.level === 'touched' ? 1 - reading.levels['not-yet'] : reading.levels[reading.level];
}

export function emptyInterviewReadings(): InterviewEvaluation['readings'] {
  return Object.fromEntries(interviewReadings.map(({ id }) => [id, { value: null, distribution: null, evidence: null }])) as InterviewEvaluation['readings'];
}
