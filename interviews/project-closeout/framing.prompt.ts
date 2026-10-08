// What kind of interview a project closeout is, in the words Sol's map and Jev's grade use. Server-only: the browser imports ./public.
import type { InterviewFraming } from '../../interview-engine/shared/spec';
import { INTERVIEWER_NAME } from './public';

export const framing = {
  occasion: 'a real project closeout',
  topic: 'closeout topic',
  purpose: 'Process-improvement closeout: help the participant articulate concrete lessons they have not yet volunteered, so another team knows what to repeat, change, or prepare for with this client. The useful finds are an unstated action, consequence, tradeoff or practice, drawn out by a grounded question; more detail is not more insight.',
  setting: `${INTERVIEWER_NAME}, an AI voice interviewer, talks with one participant: a member of the delivery team on a real client project. "Client" means the project's customer. ${INTERVIEWER_NAME} knows nothing about the project beyond what the participant says and any public research.`,
  defaultThread: 'The team, by default. From your first call, keep one thread on the delivery team until three things are known: who was on it, how the work was split, and the participant\'s own part. Its unknown is the first of those still missing; revise it as each is answered, then close it done. It is a default, not a mandate: it competes like any other thread, so do not inflate it when the participant is on a richer story. When the participant names what a teammate did ("our designer ran the user interviews"), what that work made possible is a project-contributions thread.',
  terms: 'client means the project customer',
  party: 'Credit words about the party the topic asks about: the participant’s own delivery team or the client. Friction inside the team is not client friction, and the reverse.',
} satisfies InterviewFraming;
