import { expect, test } from 'bun:test';
import { resolveInterview } from '../interview/definition.server';
import { approveDebrief, debriefVersion } from './approve.server';
import { debriefDraftSchema, slug, templateDraft, type DebriefDraft } from './debrief';

/** Plain organizer content, also used at the real SDK HTTP boundary. */
export const vendorReview: DebriefDraft = {
  title: 'Quarterly Vendor Review',
  goals: 'Learn what the vendor delivered, where the relationship helped or hindered delivery, and whether to renew.',
  guidance: 'Learn what the participant actually owned in the relationship.',
  report: { audience: 'The team deciding whether to renew', format: 'A Markdown recommendation supported by the participant’s account, with unresolved questions.' },
  topics: [
    { id: 'relationship', label: 'The relationship', learn: 'Understand delivery and friction.', topics: [
      { id: 'relationship-scope', label: 'What the vendor delivered', learn: 'Names what the vendor delivered and their own part in it.' },
      { id: 'relationship-friction', label: 'Friction', learn: 'Describes a concrete point of friction and its effect.' },
    ] },
    { id: 'future', label: 'Looking ahead', learn: 'Understand future value.', topics: [
      { id: 'future-opportunity', label: 'Future opportunities', learn: 'Names what the relationship could do next and why it matters.' },
    ] },
  ],
};
const base = resolveInterview({ ...vendorReview, id: 'vendor-review', version: 'v1' }, {
  interviewer: { name: 'Sam', persona: 'Curious and direct.', voices: [{ id: 'cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/cedar.png' }] },
  readings: [],
});

test('approval preserves editable learning content and report format under a stable content version', async () => {
  const draft = templateDraft(base);
  expect(debriefDraftSchema.safeParse(draft).success).toBe(true);
  const spec = await approveDebrief(base, { ...draft, id: 'copy' });
  expect(spec.plan).toEqual({ ...vendorReview, id: 'copy', version: spec.version });
  expect(spec.config).toEqual(base.config);
  expect(spec.version).toMatch(/^copy-[0-9a-f]{12}$/);
  expect((await approveDebrief(base, { ...draft, id: 'copy' })).version).toBe(spec.version);
  expect(await debriefVersion({ ...draft, id: 'copy', base: base.id }, base)).toBe(spec.version);
  expect((await approveDebrief(base, { ...draft, id: 'copy', goals: 'Learn whether to change vendors.' })).version).not.toBe(spec.version);
  expect((await approveDebrief(base, { ...draft, id: 'copy', report: { ...draft.report, audience: 'Procurement' } })).version).not.toBe(spec.version);
});

test('approval rejects empty plans and duplicate identities across nesting levels', async () => {
  await expect(approveDebrief(base, { ...vendorReview, topics: [] })).rejects.toThrow();
  await expect(approveDebrief(base, { ...vendorReview, topics: [{ id: 'same', label: 'Parent', learn: 'Intent', topics: [{ id: 'same', label: 'Child', learn: 'Detail' }] }] })).rejects.toThrow('unique');
  await expect(approveDebrief(base, { ...vendorReview, base: 'unknown' })).rejects.toThrow('based on unknown');
  expect(slug('  Q3 Vendor Review: Acme & Co. ')).toBe('q3-vendor-review-acme-co');
});

test('recursive grouping produces only leaf assessments and inherits parent conditions', () => {
  const spec = resolveInterview({ ...base.plan, topics: [{ id: 'delivery', label: 'Delivery', learn: 'Understand team delivery.', appliesWhen: 'The participant worked on delivery.', topics: [
    { id: 'handoff', label: 'Handoff', learn: 'Learn how handoff worked.', topics: [{ id: 'handoff-access', label: 'Access', learn: 'Describe access handoff.', appliesWhen: 'They handled access.' }] },
    { id: 'release', label: 'Release', learn: 'Describe release responsibility.' },
  ] }] }, base.config);
  expect(spec.topics.flatMap(group => group.objectives)).toEqual([
    { id: 'handoff-access', label: 'Access', criterion: 'Describe access handoff. Parent learning intent (context for this topic, not additional coverage requirements): Delivery: Understand team delivery. / Handoff: Learn how handoff worked.', appliesWhen: 'The participant worked on delivery.\nAND\nThey handled access.' },
    { id: 'release', label: 'Release', criterion: 'Describe release responsibility. Parent learning intent (context for this topic, not additional coverage requirements): Delivery: Understand team delivery.', appliesWhen: 'The participant worked on delivery.' },
  ]);
  expect(spec.plan.topics[0]?.topics?.[0]?.learn).toBe('Learn how handoff worked.');
});


test('topic IDs cannot collide with generated judgment keys', () => {
  expect(() => resolveInterview({ ...base.plan, topics: [{ id: 'handoff:evidence', label: 'Handoff', learn: 'Describe handoff.' }] }, base.config)).toThrow('IDs');
  expect(() => resolveInterview(base.plan, { ...base.config, readings: [{ id: 'detail:evidence', label: 'Detail', description: 'Detail', rubric: { task: 'How concrete?', criteria: ['0', '1', '2', '3', '4'] } }] })).toThrow('IDs');
});
