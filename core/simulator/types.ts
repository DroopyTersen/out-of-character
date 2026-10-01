import type { InterviewSession } from '../interview';

export const SIMULATOR_VERSION = 'simulator-v1';
export const SESSION_LIMIT_SECONDS = 3600;
export const SESSION_IDLE_WARNING_MS = 3 * 60_000;
export const SESSION_IDLE_TIMEOUT_MS = 5 * 60_000;
/** How long a dropped attempt is held for resume before it ends with what was captured. */
export const SESSION_PAUSE_HOLD_MS = 15 * 60_000;
/** Each resume creates a paid voice session; bound a flapping network. */
export const SESSION_MAX_RESUMES = 5;
/** Paused time extends the live limit, up to this much wall clock. */
export const SESSION_WALL_LIMIT_MS = 90 * 60_000;
export type SessionWarning = { kind: 'idle' | 'limit' | 'capacity'; endsAt: number };

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
  category: 'Sales' | 'Consultancy' | 'Interview';
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
export type SessionStatus = 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'interrupted';
/** A dropped connection holds the attempt instead of ending it; the browser may resume until resumeBy. */
export type SessionPause = { reason: 'browser' | 'provider'; pausedAt: number; resumeBy: number; resumes: number; maxResumes: number };
export type FeedbackStatus = 'waiting' | 'current' | 'delayed' | 'unavailable';
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
  interview?: InterviewSession;
  coaching: LiveHint | null;
  feedbackStatus: FeedbackStatus;
  message: string | null;
  finalization: 'pending' | 'confirmed' | 'unconfirmed';
  usageSeconds: number | null;
  /** Present while paused, and while a resume is connecting. */
  pause?: SessionPause | null;
};

export function emptySkills(): Record<SkillId, SkillReading> {
  return Object.fromEntries(skills.map(skill => [skill.id, { value: null, distribution: null, evidence: null }])) as Record<SkillId, SkillReading>;
}
