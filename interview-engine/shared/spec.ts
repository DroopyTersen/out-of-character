import { z } from 'zod';

/**
 * One thing the interview hopes to cover, judged by Jev's coverage reading. The judging text is server-only:
 * `criterion` says what covering it takes, `creditRule` narrows whose words count, and `explored` replaces the
 * default meaning of explored. A spec the browser imports leaves them out.
 */
export type Objective = { id: string; label: string; criterion?: string; creditRule?: string; explored?: string };
export type TopicGroup = { id: string; label: string; objectives: readonly Objective[] };
/** How Jev scores one reading: the question it answers and one criterion for each point of its 0–4 scale. Server-only. */
export type ReadingRubric = { task: string; criteria: readonly string[] };
/** One reading of the participant on Jev's scale (for example specificity). */
export type Reading = { id: string; label: string; description: string; rubric?: ReadingRubric };
/** `voice` is the voice provider's voice name; `image` is the host's portrait for it. */
export type Voice = { id: string; voice: string; label: string; presentation: string; image: string };
/** How the Narrative phase writes its document: a system prompt and the structured output it must return. */
export type NarrativeTemplate<T = unknown> = { id: string; version: string; system: string; schema: z.ZodType<T> };
export type InterviewLimits = { durationSeconds: number; idleWarningMs: number; idleTimeoutMs: number; pauseHoldMs: number; maxResumes: number };

/** What one kind of interview is about. */
export type InterviewSpec = {
  id: string;
  version: string;
  /**
   * The voice model's side of the interview. The brief text is server-only: `role` completes “You are <name>, …”,
   * `persona` is the manner, `orientation` and `boundaries` are the spec's ground rules, and `opening` is the first line.
   */
  interviewer: { name: string; voices: readonly Voice[]; role?: string; persona?: string; opening?: string; orientation?: readonly string[]; boundaries?: readonly string[] };
  topics: readonly TopicGroup[];
  readings: readonly Reading[];
  limits?: InterviewLimits;
  narrative: NarrativeTemplate;
};

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = z.string().trim().min(1);
const unique = (ids: string[]) => new Set(ids).size === ids.length;

const specSchema = z.object({
  id,
  version: text,
  interviewer: z.object({
    name: text,
    voices: z.array(z.object({ id, voice: text, label: text, presentation: text, image: text })).min(1)
      .refine(voices => unique(voices.map(voice => voice.id)), 'Voice ids must be unique.'),
    role: text.optional(),
    persona: text.optional(),
    opening: text.optional(),
    orientation: z.array(text).optional(),
    boundaries: z.array(text).optional(),
  }),
  topics: z.array(z.object({ id, label: text, objectives: z.array(z.object({ id, label: text, criterion: text.optional(), creditRule: text.optional(), explored: text.optional() })).min(1) })).min(1)
    .refine(topics => unique(topics.map(topic => topic.id)), 'Topic ids must be unique.')
    .refine(topics => unique(topics.flatMap(topic => topic.objectives.map(objective => objective.id))), 'Objective ids must be unique.'),
  readings: z.array(z.object({ id, label: text, description: text, rubric: z.object({ task: text, criteria: z.array(text).length(5) }).optional() }))
    .refine(readings => unique(readings.map(reading => reading.id)), 'Reading ids must be unique.'),
  limits: z.object({
    durationSeconds: z.number().int().positive(),
    idleWarningMs: z.number().int().positive(),
    idleTimeoutMs: z.number().int().positive(),
    pauseHoldMs: z.number().int().nonnegative(),
    maxResumes: z.number().int().nonnegative(),
  }).refine(limits => limits.idleWarningMs < limits.idleTimeoutMs, 'The idle warning must come before the idle timeout.').optional(),
  narrative: z.object({ id, version: text, system: text, schema: z.custom<z.ZodType>(value => value instanceof z.ZodType, 'Expected a zod schema.') }),
});

/** Checks a spec once, where it is declared, and returns it unchanged so its literal types survive. */
export function validateSpec<const S extends InterviewSpec>(spec: S): S {
  const parsed = specSchema.safeParse(spec);
  if (!parsed.success) throw new Error(`Invalid interview spec ${spec.id}: ${z.prettifyError(parsed.error)}`);
  return spec;
}
