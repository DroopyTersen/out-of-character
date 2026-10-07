import type { ObjectiveReading, SkillReading } from './simulator/types';
import { z } from 'zod';

export const INTERVIEW_SCENARIO_ID = 'project-closeout';
export const INTERVIEWER_NAME = 'Sam';
export const interviewVoices = [
  { id: 'sam-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/interview/sam-male.png' },
  { id: 'sam-gleam', voice: 'gleam', label: 'Gleam', presentation: 'Female', image: '/interview/sam-female.png' },
] as const;

export const interviewReadings = [
  { id: 'engagement', label: 'Engagement', description: 'Following the conversation and developing an answer.' },
  { id: 'openness', label: 'Openness', description: 'Sharing your perspective, including uncertainty and tradeoffs.' },
  { id: 'specificity', label: 'Specificity', description: 'Giving concrete examples of what happened.' },
] as const;
export type InterviewReadingId = typeof interviewReadings[number]['id'];

export const interviewTopics = [
  { id: 'project', label: 'What you delivered', objectives: [
    { id: 'project-delivery', label: 'Deliverables & scope' },
    { id: 'project-role', label: 'Your role' },
    { id: 'project-contributions', label: 'Who contributed what' },
    { id: 'project-reflection', label: 'Standouts & growth' },
  ] },
  { id: 'client', label: 'Working with the client', objectives: [
    { id: 'client-access', label: 'Onboarding & access' },
    { id: 'client-decisions', label: 'Decisions & stakeholders' },
    { id: 'client-pace', label: 'Pace & approvals' },
    { id: 'client-coordination', label: 'Teams, vendors & silos' },
    { id: 'client-friction', label: 'Friction & advice for next time' },
  ] },
  { id: 'process', label: 'How the team worked', objectives: [
    { id: 'process-worked', label: 'What worked well' },
    { id: 'process-improve', label: 'What could work better' },
    { id: 'process-communication', label: 'Communication & handoffs' },
    { id: 'process-tools', label: 'Tools & process' },
    { id: 'process-resourcing', label: 'Support, staffing & time' },
  ] },
] as const;

/** How far a topic has been covered. Set aside means the participant declined it, cannot speak to it, or says it does not apply. */
export const COVERAGE_LEVELS = ['not-yet', 'touched', 'explored', 'set-aside'] as const;
export type CoverageLevel = typeof COVERAGE_LEVELS[number];
/** `probability` is P(explored); `achieved` means explored. */
export type InterviewObjectiveReading = ObjectiveReading & { level: CoverageLevel; levels: Record<CoverageLevel, number> | null };

export type InterviewEvaluation = {
  revision: number;
  readings: Record<InterviewReadingId, SkillReading>;
  objectives: InterviewObjectiveReading[];
  model: string;
  durationMs: number;
};
export type InterviewSummary = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };
export const interviewSummarySchema = z.strictObject({ text: z.string().trim().min(1) });
export type InterviewSummaryContent = z.infer<typeof interviewSummarySchema>;
/** Public references only; preparation and producer directions remain private. */
export type InterviewBackground = {
  id: string;
  target: { kind: 'organization' | 'product' | 'term'; name: string };
  facts: { text: string; url: string; title: string }[];
  retrievedAt: number;
};
/**
 * `listening` marks a session in which code times Sam's turn: Sam stays quiet through the participant's pauses and speaks
 * once a turn note hands over the floor. It is absent on sessions started before the listening hold, which ran without
 * it. Sessions started while a short acknowledgment could be chosen may say 'ack'; they resume with quiet listening.
 */
export type InterviewSession = { evaluation: InterviewEvaluation | null; summary: InterviewSummary | null; background?: InterviewBackground[]; listening?: 'quiet' | 'ack' };

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
