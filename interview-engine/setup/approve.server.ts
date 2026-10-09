import { resolveInterview, type ResolvedInterview } from '../interview/definition.server';
import { approvedDebriefSchema, slug, type ApprovedDebrief, type DebriefDraft } from './debrief';

/** The first twelve hex digits of the SHA-256 of `text`. */
const digest = async (text: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
};

/** The id an approval gives a draft: the one given, or the title's slug. */
export const approvedId = (input: { id?: string; title: string }) => input.id ?? slug(input.title);

/**
 * The version an approval produces: the id, then a digest of everything the spec is built from, including the base
 * template's version. The same approved content always has the same version; any edit, or a new base, changes it.
 */
export async function debriefVersion(record: ApprovedDebrief, base: Pick<ResolvedInterview, 'id' | 'version'>): Promise<string> {
  return `${record.id}-${await digest(canonical({ base: { id: base.id, version: base.version }, record }))}`;
}
/** JSON with every object's keys sorted, so equal records always digest alike. */
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);

/** Compile the organizer's approved content with the host's runtime configuration. */
export async function approveDebrief(base: ResolvedInterview, input: DebriefDraft & { id?: string; base?: string }): Promise<ResolvedInterview> {
  const record = approvedDebriefSchema.parse({ ...input, id: approvedId(input), base: input.base ?? base.id });
  if (record.base !== base.id) throw new Error(`Debrief ${record.id} is based on ${record.base}, not ${base.id}.`);
  const { base: _base, ...plan } = record;
  return resolveInterview({ ...plan, version: await debriefVersion(record, base) }, base.config);
}
