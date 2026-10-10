import { z } from 'zod';
import { interviewContextSchema, text } from '../../interview-engine/shared/plan';
import { TRANSCRIPT_LIMIT, transcriptCharacters } from '../../interview-engine/shared/transcript';
/** The outcome and metered usage of one attempt to write a narrative. */
export type NarrativeFailure = 'provider' | 'invalid' | 'cancelled' | 'timeout';
export type NarrativeUsage = { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cachedTokens: number | null };
export type NarrativeAttempt = { startedAt: number; endedAt: number; failure: NarrativeFailure | null; usage: NarrativeUsage | null };
/** Retained with the interview when its narrative settles. */
export type NarrativeProvenance = { model: string; version: string; attempts: NarrativeAttempt[] };

/** One Markdown document. The report module owns its output schema. */
export const narrativeDocumentSchema = z.strictObject({ text: z.string().trim().min(1) });
export const NARRATIVE_VERSION = 'interview-narrative-v2';

export const reportFormatSchema = z.object({ audience: text.max(2000), format: text.max(16_000) }).strict();
export type ReportFormat = z.infer<typeof reportFormatSchema>;

const passageSchema = z.object({
  id: z.string().min(1).max(100), speaker: z.enum(['participant', 'interviewer']), text: z.string().max(TRANSCRIPT_LIMIT.characters),
  startMs: z.number().min(0), endMs: z.number().min(0),
}).strict();
/** Phase 2 is independent of live sessions, plans, conversation maps and coverage judgments. */
export const narrativeRequestSchema = z.object({
  transcript: z.array(passageSchema).max(TRANSCRIPT_LIMIT.entries)
    .refine(passages => transcriptCharacters(passages) <= TRANSCRIPT_LIMIT.characters, 'The transcript is too long.')
    .refine(passages => new Set(passages.map(passage => passage.id)).size === passages.length, 'Passage IDs must be unique.'),
  format: reportFormatSchema,
  context: interviewContextSchema.optional(),
}).strict();
export type NarrativeRequest = z.infer<typeof narrativeRequestSchema>;


export type NarrativeStatus = { status: 'pending' | 'ready' | 'unavailable'; text: string | null };

/** The written document: Markdown prose, as the spec's narrative schema returns it. */
export type NarrativeDocument = { text: string };
export type Narrative =
  | { document: NarrativeDocument; failure: null; usage: NarrativeUsage }
  | { document: null; failure: NarrativeFailure; usage: NarrativeUsage | null };
/** One writing attempt: text as it is written, and how it ended. `result` settles once, after or alongside the stream. */
export type NarrativeRun = { stream: ReadableStream<string>; result: Promise<Narrative> };
/** The entire writing input: participant transcript, requested format and explicit supplied context. */
export type NarrativeInput = NarrativeRequest;

export type NarrativeState = { starts: number } & (
  | { status: 'idle' | 'running'; document: null; failure: null }
  | { status: 'completed'; document: NarrativeDocument; failure: null }
  | { status: 'failed'; document: null; failure: NarrativeFailure }
);
