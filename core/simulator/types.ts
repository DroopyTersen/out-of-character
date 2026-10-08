import type { FeedbackStatus, SessionPause, SessionStatus } from '../../interview-engine/shared/snapshot';
import type { InterviewSession } from '../interview';

export const SIMULATOR_VERSION = 'simulator-v1';
export {
  SESSION_IDLE_TIMEOUT_MS, SESSION_IDLE_WARNING_MS, SESSION_LIMIT_SECONDS, SESSION_MAX_RESUMES, SESSION_PAUSE_HOLD_MS, SESSION_WALL_LIMIT_MS, SPEECH_QUIET_MS,
} from '../../interview-engine/shared/timing';
/** client: the client walked out; the session ends once its closing line finishes. */
export type SessionWarning = { kind: 'idle' | 'limit' | 'capacity' | 'client'; endsAt: number };
/** The evaluator's walk-out judgment that ended (or is ending) the meeting. */
export type ClientEnding = { passageId: string; probability: number; detectedAt: number };

export const skills = [
  { id: 'credibility', label: 'Credibility', description: 'Gives this client a reason to trust the advice.' },
  { id: 'confidence', label: 'Confidence', description: 'Conveys a dependable way forward.' },
  { id: 'listening', label: 'Listening', description: 'Uses what the client actually says.' },
  { id: 'rapport', label: 'Rapport', description: 'Builds a productive connection with this client.' },
  { id: 'clarity', label: 'Clarity', description: 'Makes explanations and recommendations understandable.' },
  { id: 'guidance', label: 'Guidance', description: 'Moves the conversation somewhere useful together.' },
  { id: 'adaptability', label: 'Adaptability', description: 'Adjusts when an approach or circumstance changes.' },
] as const;

export type SkillId = typeof skills[number]['id'];
export type Speaker = 'trainee' | 'client';
export type ObjectiveKind = 'discovery' | 'behavior' | 'outcome';
export type ClientStats = {
  assertiveness: number;
  skepticism: number;
  guardedness: number;
  bargaining: number;
  riskAversion: number;
  relationship: number;
};
export type Client = {
  id: string;
  name: string;
  style: string;
  description: string;
  image: string;
};
export type ScenarioSummary = {
  id: string;
  title: string;
  category: 'Sales' | 'Consultancy';
  summary: string;
  lead: string;
  briefing?: string[];
  role: string;
  clientRole: string;
  durationMinutes: number;
  /** An empty list is an open conversation, without judging or coaching. */
  objectives: { id: string; label: string; kind: ObjectiveKind }[];
  services: string[];
};
export type Catalog = { version: string; scenarios: ScenarioSummary[]; clients: Client[] };

export type TranscriptEntry = {
  id: string;
  speaker: Speaker;
  text: string;
  startMs: number;
  endMs: number;
};
export type Evidence = { entryId: string; speaker: Speaker; text: string };
export type SkillReading = { value: number | null; distribution: Record<string, number> | null; evidence: Evidence | null };
export type ObjectiveReading = {
  id: string;
  probability: number | null;
  achieved: boolean;
  evidence: Evidence | null;
};
export type FeedbackAssessment = {
  skills: Record<SkillId, Pick<SkillReading, 'value' | 'evidence'>>;
  objectives: Pick<ObjectiveReading, 'id' | 'achieved' | 'evidence'>[];
};
export type TraineeEvaluation = {
  revision: number;
  skills: Record<SkillId, SkillReading>;
  objectives: ObjectiveReading[];
  concern: string | null;
  model: string;
  durationMs: number;
};
export type { FeedbackStatus, SessionPause, SessionStatus } from '../../interview-engine/shared/snapshot';
export type LiveHint = { id: string; text: string; kind: 'hint' | 'concern'; objectiveId: string | null; evidenceIds: string[]; createdAt: number; expiresAt: number };
export type SessionSnapshot = {
  id: string;
  scenarioId: string;
  clientId: string;
  status: SessionStatus;
  startedAt: number;
  limitSeconds: number;
  warning: SessionWarning | null;
  revision: number;
  transcript: TranscriptEntry[];
  evaluation: TraineeEvaluation | null;
  coaching: LiveHint | null;
  feedbackStatus: FeedbackStatus;
  message: string | null;
  finalization: 'pending' | 'confirmed' | 'unconfirmed';
  usageSeconds: number | null;
  /** Present while paused, and while a resume is connecting. */
  pause?: SessionPause | null;
  clientEnded?: ClientEnding | null;
};

/**
 * What the browser receives: the session's snapshot, plus the interview's readings, summary status and background
 * for an interview. The interview object keeps that state beside its snapshot and composes this on the way out.
 */
export type PublicSnapshot = SessionSnapshot & { interview?: InterviewSession };

export function emptySkills(): Record<SkillId, SkillReading> {
  return Object.fromEntries(skills.map(skill => [skill.id, { value: null, distribution: null, evidence: null }])) as Record<SkillId, SkillReading>;
}
