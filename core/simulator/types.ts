export const SIMULATOR_VERSION = 'simulator-v1';
export const SESSION_LIMIT_SECONDS = 600;

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
export type TraineeEvaluation = {
  revision: number;
  skills: Record<SkillId, SkillReading>;
  objectives: ObjectiveReading[];
  hint: string | null;
  hintId?: string | null;
  concern: string | null;
  model: string;
  durationMs: number;
};
export type SessionStatus = 'connecting' | 'live' | 'ending' | 'ended' | 'interrupted';
export type FeedbackStatus = 'waiting' | 'current' | 'delayed' | 'unavailable';
export type SessionSnapshot = {
  id: string;
  scenarioId: string;
  clientId: string;
  status: SessionStatus;
  startedAt: number;
  limitSeconds: number;
  revision: number;
  transcript: TranscriptEntry[];
  evaluation: TraineeEvaluation | null;
  feedbackStatus: FeedbackStatus;
  message: string | null;
  finalization: 'pending' | 'confirmed' | 'unconfirmed';
  usageSeconds: number | null;
};

export function emptySkills(): Record<SkillId, SkillReading> {
  return Object.fromEntries(skills.map(skill => [skill.id, { value: null, distribution: null, evidence: null }])) as Record<SkillId, SkillReading>;
}
