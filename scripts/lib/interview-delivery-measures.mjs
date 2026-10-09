// Measures for scripts/interview-delivery-probe.mjs, kept apart so they can be tested without a paid run.
// They are tuned to the probe's scripted participant: the target thread is launch approval.

export const words = text => text.toLowerCase().replace(/’/g, '\'').match(/[a-z0-9']+/g) ?? [];
export const trigrams = text => { const list = words(text); return new Set(list.slice(2).map((_, index) => list.slice(index, index + 3).join(' '))); };
export const THREADS = {
  // Neither of the other threads involves the launch, so any mention of it counts.
  target: /approv|sign.?off|signed off|final (call|say|decision)|go(ing|es)?.?live|green.?light|\blaunch/i,
  vpn: /\bvpn\b|access|three.?weeks?|waited|waiting/i,
  priya: /priya|pipeline|hand.?(off|over)|took over|newest/i,
};
/** Threads the text names, the last named first. */
export const named = text => Object.entries(THREADS).flatMap(([id, pattern]) => {
  const at = [...text.matchAll(new RegExp(pattern, 'gi'))].at(-1)?.index;
  return at == null ? [] : [[id, at]];
}).sort((a, b) => b[1] - a[1]).map(([id]) => id);
/** Mentions of the notes or the brief, and the note templates' own wording. */
export const LEAK = /\b(my|the|these|those) notes?\b|note.?taker|thread note|map note|supersede|still unknown|worth pulling|keep pulling|also open|off the table|been (told|asked) to|supposed to ask|my (brief|instructions)/i;

/**
 * The thread Sam's turn asks about, read from its questions alone, when they name exactly one. Questions that name none
 * ("What did that break for you?") or several ("Did the VPN wait push the launch?") leave the turn unclear, to be
 * labelled by hand; a turn with no question asks nothing.
 */
export function classify(text) {
  const questions = text.replace(/\.{2,}|…/g, ' ').match(/[^.?!]*\?/g)?.map(item => item.trim()).filter(Boolean) ?? [];
  const question = questions.join(' ') || null;
  const threads = question ? named(question) : [];
  return { question, asked: threads.length === 1 ? threads[0] : null, threads, unclear: !!question && threads.length !== 1 };
}

/** Parroting counts the note's word triples that nobody said aloud: `spoken` is the participant's lines and the opening. */
export function measure(text, noteText, spoken) {
  const heard = trigrams(spoken);
  const noteOnly = [...trigrams(noteText.split('\n').slice(1).join(' '))].filter(gram => !heard.has(gram));
  const said = trigrams(text);
  const parroted = noteOnly.filter(gram => said.has(gram));
  return { text, ...classify(text), parroted, parrotShare: said.size ? Math.round(parroted.length / said.size * 100) / 100 : 0, leak: text.match(LEAK)?.[0] ?? null };
}

/** A hand label, when there is one, overrides the classified thread; 'other' is a question on none of the three. */
export const askedIn = segment => segment?.label ?? classify(segment?.text ?? '').asked;

/** What the participant must be heard saying: the three threads, and the brush-off that tests a re-ask. */
const HEARD = [/launch|approv/i, /\bv\.?\s?p\.?\s?n\b/i, /priya|pipeline/i, /routine|more to add/i];

/** Why a run can't be scored, or null. Such runs are left out of the rates and redone on resume. */
export function unusable(report) {
  if (!report.finalized) return 'not finalized';
  if (report.errors.length) return 'errors';
  if (report.deadAir?.length) return 'dead air';
  if (!report.segments[0]?.text || !report.segments[1]?.text) return 'a measured reply is missing';
  const participant = report.transcript.filter(entry => entry.speaker === 'participant').map(entry => entry.text).join(' ');
  if (!HEARD.every(pattern => pattern.test(participant))) return 'the participant was not heard';
  return null;
}
