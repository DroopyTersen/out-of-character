import { z } from 'zod';
import type { InterviewFraming, InterviewSpec, Objective, TopicGroup } from '../shared/spec';

/**
 * A debrief as its organizer sets it up, before any attempt runs: plain data an organizer can read, edit and approve.
 * A template's draft comes from its spec (`templateDraft`); an ad hoc debrief's draft comes from a description (the
 * `draftDebrief` call). Approving either produces an InterviewSpec by merging the draft onto a base template
 * (`approveDebrief`), so the live engine only ever sees specs.
 */
export type DebriefTopic = { id: string; label: string; objectives: { id: string; label: string; criterion: string }[] };
export type DebriefDraft = {
  /** The organizer's name for the debrief; the approved id is its slug unless one is given. */
  title: string;
  /** What the interviewer is doing, completing “You are <name>, …”. */
  role: string;
  /** The interviewer's first words. */
  opening: string;
  /** What the debrief is for and how the interviewer gets oriented in the first minutes. */
  orientation: string[];
  /** How Sol's map and Jev's grade describe the debrief; `topic` is fixed to “debrief topic” for an ad hoc debrief. */
  framing: Omit<InterviewFraming, 'topic'>;
  topics: DebriefTopic[];
};
/** A draft the organizer approved: the template it borrows its brief, readings and limits from, and its id. */
export type ApprovedDebrief = DebriefDraft & { id: string; base: string };

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = z.string().trim().min(1);
const unique = (ids: string[]) => new Set(ids).size === ids.length;

export const debriefDraftSchema = z.object({
  title: text.max(120),
  role: text.max(400),
  opening: text.max(1200),
  orientation: z.array(text.max(2000)).min(1).max(6),
  framing: z.object({ occasion: text.max(200), purpose: text.max(2000), setting: text.max(2000), defaultThread: text.max(2000), terms: text.max(600), party: text.max(600) }),
  topics: z.array(z.object({
    id, label: text.max(120),
    objectives: z.array(z.object({ id, label: text.max(120), criterion: text.max(1200) })).min(1),
  })).min(1)
    .refine(topics => unique(topics.map(topic => topic.id)), 'Topic ids must be unique.')
    .refine(topics => unique(topics.flatMap(topic => topic.objectives.map(objective => objective.id))), 'Objective ids must be unique.'),
}).strict();
export const approvedDebriefSchema = debriefDraftSchema.safeExtend({ id, base: id });

/** A spec id from a title: lowercase words joined by hyphens. */
export const slug = (title: string) => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** The editable draft of a template, for the organizer to approve as is or change first. */
export function templateDraft(spec: InterviewSpec): DebriefDraft {
  const { interviewer, framing } = spec;
  if (!framing || !interviewer.role || !interviewer.opening || !interviewer.orientation) throw new Error(`Spec ${spec.id} has no brief to draft from.`);
  const { topic: _topic, ...rest } = framing;
  return {
    title: spec.id.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' '),
    role: interviewer.role, opening: interviewer.opening, orientation: [...interviewer.orientation],
    framing: rest,
    topics: spec.topics.map(topic => ({ id: topic.id, label: topic.label, objectives: topic.objectives.map(objective => ({ id: objective.id, label: objective.label, criterion: objective.criterion ?? objective.label })) })),
  };
}

/** The topics as the engine reads them. */
export const draftTopics = (draft: DebriefDraft): (TopicGroup & { objectives: (Objective & { criterion: string })[] })[] => draft.topics.map(topic => ({ id: topic.id, label: topic.label, objectives: topic.objectives.map(objective => ({ ...objective })) }));
