import { validateSpec, type InterviewFraming, type InterviewSpec, type NarrativeTemplate, type Objective, type TopicGroup } from '../shared/spec';
import { approvedDebriefSchema, draftTopics, slug, type ApprovedDebrief, type DebriefDraft } from './debrief';
import { DEBRIEF_NARRATIVE_VERSION, debriefNarrativeSchema, debriefNarrativeSystem } from './narrative.prompt';

/** The first twelve hex digits of the SHA-256 of `text`. */
const digest = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
};

/** The spec an approval builds on base `S`: the base's cast, persona, boundaries, techniques, readings and limits under the draft's brief, framing, topics and narrative. */
export type ApprovedSpec<S extends InterviewSpec> = Omit<S, 'id' | 'version' | 'interviewer' | 'framing' | 'topics' | 'narrative'> & {
  id: string; version: string;
  interviewer: Omit<S['interviewer'], 'role' | 'opening' | 'orientation'> & { role: string; opening: string; orientation: readonly string[] };
  framing: InterviewFraming;
  topics: readonly (TopicGroup & { objectives: readonly (Objective & { criterion: string })[] })[];
  narrative: NarrativeTemplate<{ text: string }>;
};

/** The id an approval gives a draft: the one given, or the title's slug. */
export const approvedId = (input: { id?: string; title: string }) => input.id ?? slug(input.title);

/**
 * The version an approval produces: the id, then a digest of everything the spec is built from, including the base
 * template's version. The same approved content always has the same version; any edit, or a new base, changes it.
 */
export async function debriefVersion(record: ApprovedDebrief, base: Pick<InterviewSpec, 'id' | 'version'>): Promise<string> {
  return `${record.id}-${await digest(canonical({ base: { id: base.id, version: base.version }, record }))}`;
}
/** JSON with every object's keys sorted, so equal records always digest alike. */
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);

/**
 * The spec an approved debrief runs under. The draft supplies the interviewer's role, opening and orientation, the
 * framing and the topics with their criteria; the base template supplies the interviewer's name and voices, persona,
 * boundaries and techniques, the readings and the limits. The narrative is the engine's topic-sectioned debrief
 * narrative. Throws when the record or the resulting spec is invalid.
 */
export async function approveDebrief<S extends InterviewSpec>(base: S, input: DebriefDraft & { id?: string; base?: string }): Promise<ApprovedSpec<S>> {
  const parsed = approvedDebriefSchema.safeParse({ ...input, id: approvedId(input), base: input.base ?? base.id });
  if (!parsed.success) throw new Error(`Invalid debrief: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const record = parsed.data;
  if (record.base !== base.id) throw new Error(`Debrief ${record.id} is based on ${record.base}, not ${base.id}.`);
  const { id: _id, version: _version, interviewer, framing: _framing, topics: _topics, narrative: _narrative, ...rest } = base;
  const { role: _role, opening: _opening, orientation: _orientation, ...cast } = interviewer as S['interviewer'] & { role?: string; opening?: string; orientation?: readonly string[] };
  return validateSpec<ApprovedSpec<S>>({
    ...(rest as Omit<S, 'id' | 'version' | 'interviewer' | 'framing' | 'topics' | 'narrative'>),
    id: record.id,
    version: await debriefVersion(record, base),
    interviewer: { ...(cast as Omit<S['interviewer'], 'role' | 'opening' | 'orientation'>), role: record.role, opening: record.opening, orientation: record.orientation },
    framing: { ...record.framing, topic: 'debrief topic' },
    topics: draftTopics(record),
    narrative: { id: `${record.id}-narrative`, version: DEBRIEF_NARRATIVE_VERSION, system: debriefNarrativeSystem(record), schema: debriefNarrativeSchema },
  });
}
