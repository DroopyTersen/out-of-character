// What kind of interview a win/loss debrief is, in the words Sol's map and Jev's grade use. Server-only: the browser imports ./public.
import type { InterviewFraming } from '../../interview-engine/shared/spec';
import { salesInterviewerName } from './public';

export const framing = {
  occasion: 'a buyer’s win/loss debrief',
  topic: 'debrief topic',
  purpose: 'Win/loss debrief: help the buyer put into words the real reasons behind their purchase decision, so the vendor knows what to keep doing, what to fix, and where it lost or won ground. The useful finds are an unstated criterion, doubt, comparison or turning point, drawn out by a grounded question; a longer account is not a better one.',
  setting: `${salesInterviewerName}, an AI voice interviewer asking on the vendor's behalf, talks with one participant: someone from the buying organization who took part in a recent purchase decision. "The vendor" means the company the debrief is for; "competitors" are the other options the buyer considered. ${salesInterviewerName} knows nothing about the deal beyond what the participant says and any public research.`,
  defaultThread: 'The outcome, by default. From your first call, keep one thread on the decision itself until three things are known: what was bought, which option won (the vendor, a competitor, or nothing), and the participant\'s own part in choosing. Its unknown is the first of those still missing; revise it as each is answered, then close it done. It is a default, not a mandate: it competes like any other thread, so do not inflate it when the participant is on a richer story.',
  terms: 'the vendor means the company the debrief is for, and competitors are the other options the buyer considered',
  party: 'Credit words about the party the topic asks about: the buyer’s own organization, the vendor, or a competitor. Praise for a competitor is not praise for the vendor, and the reverse.',
} satisfies InterviewFraming;
