import { expect, test } from 'bun:test';
import { z } from 'zod';
import { testFraming, testTechniques } from '../interview/conversation/testSpec';
import { validateSpec, type InterviewSpec } from '../shared/spec';
import { approveDebrief, debriefVersion } from './approve.server';
import { debriefDraftSchema, slug, templateDraft, type DebriefDraft } from './debrief';
import { DEBRIEF_NARRATIVE_VERSION, debriefNarrativeSystem } from './narrative.prompt';

/** For tests: a complete template the way a host ships one, under a stable id and version. */
function template(id: string, voices: InterviewSpec['interviewer']['voices']): InterviewSpec {
  return validateSpec({
    id, version: `${id}-v1`,
    interviewer: {
      name: 'Sam', voices, role: `interviewing someone about ${id.replace(/-/g, ' ')}`, persona: 'Curious and direct.', opening: 'Hi, I’m Sam. What did you work on?',
      orientation: ['ORIENTATION'], boundaries: ['BOUNDARY'], techniques: testTechniques,
    },
    framing: testFraming,
    topics: [{ id: 'project', label: 'The project', objectives: [{ id: 'project-delivery', label: 'Deliverables', criterion: 'Names what was built.' }] }],
    readings: [{ id: 'specificity', label: 'Specificity', description: 'Concrete detail.', rubric: { task: 'How concrete?', criteria: ['zero', 'one', 'two', 'three', 'four'] } }],
    narrative: { id: `${id}-narrative`, version: 'fixture-narrative-v1', system: 'FIXTURE NARRATIVE', schema: z.object({ text: z.string() }) },
  });
}
const projectCloseout = template('project-closeout', [{ id: 'sam-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/sam-cedar.png' }]);
const salesWinLoss = template('sales-win-loss', [{ id: 'sam-meridian', voice: 'meridian', label: 'Meridian', presentation: 'Female', image: '/sam-meridian.png' }]);

/** An ad hoc debrief as an organizer might approve it: a quarterly review of one vendor relationship. */
export const vendorReview: DebriefDraft = {
  title: 'Quarterly Vendor Review',
  role: 'interviewing someone about a vendor relationship they managed this quarter',
  opening: 'Hi, I’m Sam. This is a debrief about the vendor relationship you managed this quarter. What was your part in it?',
  orientation: ['The debrief is for the team deciding whether to renew. Learn early what the participant actually owned in the relationship, so later questions fit what they did. Never re-ask what has been answered.'],
  framing: {
    occasion: 'a real quarterly vendor review', purpose: 'The review decides whether to renew; a useful find is an unstated consequence, tradeoff or practice.',
    setting: 'Sam talks with the person who managed the relationship and knows nothing beyond what they say and public research.',
    defaultThread: 'What the participant owned and who else was involved, until known.', terms: 'A topic is one area the review covers.', party: 'Only the participant’s own words count toward a topic.',
  },
  topics: [
    { id: 'relationship', label: 'The relationship', objectives: [
      { id: 'relationship-scope', label: 'What the vendor delivered', criterion: 'The participant names what the vendor delivered this quarter and their own role in it. A product name alone is insufficient.' },
      { id: 'relationship-friction', label: 'Friction', criterion: 'The participant describes a concrete point of friction and its effect. A general complaint without an effect is insufficient.' },
    ] },
    { id: 'future', label: 'Looking ahead', objectives: [
      { id: 'future-opportunity', label: 'Future opportunities', criterion: 'The participant names something the relationship could do next and why it matters.' },
    ] },
  ],
};

test('a template’s draft round-trips: approving it unchanged keeps its brief, framing and topics, under a stable version', async () => {
  const draft = templateDraft(projectCloseout);
  expect(debriefDraftSchema.safeParse(draft).success).toBe(true);
  expect(draft.topics.map(topic => topic.id)).toEqual(projectCloseout.topics.map(topic => topic.id));
  const spec = await approveDebrief(projectCloseout, { ...draft, id: 'closeout-copy' });
  expect(spec.id).toBe('closeout-copy');
  expect(spec.version).toMatch(/^closeout-copy-[0-9a-f]{12}$/);
  expect(spec.interviewer).toMatchObject({ name: projectCloseout.interviewer.name, voices: projectCloseout.interviewer.voices, persona: projectCloseout.interviewer.persona, role: projectCloseout.interviewer.role, opening: projectCloseout.interviewer.opening });
  expect(spec.framing).toEqual({ ...testFraming, topic: 'debrief topic' });
  expect(spec.topics.flatMap(topic => topic.objectives.map(objective => [objective.id, objective.criterion]))).toEqual(projectCloseout.topics.flatMap(topic => topic.objectives.map(objective => [objective.id, objective.criterion])));
  expect(spec.readings).toBe(projectCloseout.readings);
  expect((await approveDebrief(projectCloseout, { ...draft, id: 'closeout-copy' })).version).toBe(spec.version);
});

test('an ad hoc debrief gets its id from its title, its cast from the base, and a version that changes with any edit or a new base', async () => {
  const spec = await approveDebrief(projectCloseout, vendorReview);
  expect(spec.id).toBe('quarterly-vendor-review');
  expect(spec.interviewer.voices).toBe(projectCloseout.interviewer.voices);
  expect(spec.interviewer.role).toBe(vendorReview.role);
  expect(spec.topics.map(topic => topic.id)).toEqual(['relationship', 'future']);
  expect(spec.narrative.version).toBe(DEBRIEF_NARRATIVE_VERSION);
  expect(spec.narrative.system).toContain('## Looking ahead');
  expect(spec.narrative.schema.safeParse({ text: 'Summary.' }).success).toBe(true);
  const edited = await approveDebrief(projectCloseout, { ...vendorReview, topics: [vendorReview.topics[0]!] });
  expect(edited.version).not.toBe(spec.version);
  const rebased = await approveDebrief(salesWinLoss, vendorReview);
  expect(rebased.version).not.toBe(spec.version);
  expect(rebased.interviewer.voices).toBe(salesWinLoss.interviewer.voices);
  expect(await debriefVersion({ ...vendorReview, id: 'quarterly-vendor-review', base: projectCloseout.id }, projectCloseout)).toBe(spec.version);
});

test('approval rejects records the engine could not run', async () => {
  await expect(approveDebrief(projectCloseout, { ...vendorReview, topics: [] })).rejects.toThrow('Invalid debrief');
  await expect(approveDebrief(projectCloseout, { ...vendorReview, topics: [vendorReview.topics[0]!, vendorReview.topics[0]!] })).rejects.toThrow('unique');
  await expect(approveDebrief(projectCloseout, { ...vendorReview, title: 'Quarterly Vendor Review', id: 'Not A Slug' })).rejects.toThrow('Invalid debrief');
  await expect(approveDebrief(projectCloseout, { ...vendorReview, base: salesWinLoss.id })).rejects.toThrow(`based on ${salesWinLoss.id}`);
  expect(slug('  Q3 Vendor Review: Acme & Co. ')).toBe('q3-vendor-review-acme-co');
  expect(debriefNarrativeSystem(vendorReview)).toContain('untrusted data');
});
