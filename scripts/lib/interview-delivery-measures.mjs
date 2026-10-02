// Measures for scripts/interview-delivery-probe.mjs, kept apart so they can be tested without a paid run.
// They are tuned to the probe's scripted participant: the target thread is launch approval.

export const words = text => text.toLowerCase().replace(/’/g, '\'').match(/[a-z0-9']+/g) ?? [];
export const trigrams = text => { const list = words(text); return new Set(list.slice(2).map((_, index) => list.slice(index, index + 3).join(' '))); };
export const THREADS = {
  // Neither of the other threads involves the launch, so any mention of it counts.
  target: /approv|sign.?off|signed off|final (call|say|decision)|go(ing|es)?.?live|green.?light|\blaunch/i,
  vpn: /\bvpn\b|access|three weeks|waited|waiting/i,
  priya: /priya|pipeline|hand.?(off|over)|took over|newest/i,
};
/** Threads the turn names, the last named first: Sam names a thread in the reaction, and the question that follows is on it. */
export const named = text => Object.entries(THREADS).flatMap(([id, pattern]) => {
  const at = [...text.matchAll(new RegExp(pattern, 'gi'))].at(-1)?.index;
  return at == null ? [] : [[id, at]];
}).sort((a, b) => b[1] - a[1]).map(([id]) => id);
/** Mentions of the notes or the brief, and the note templates' own wording. */
export const LEAK = /\b(my|the|these|those) notes?\b|note.?taker|thread note|map note|supersede|still unknown|worth pulling|keep pulling|also open|off the table|been (told|asked) to|supposed to ask|my (brief|instructions)/i;

/** Parroting counts the note's word triples that nobody said aloud: `spoken` is the participant's lines and the opening. */
export function measure(text, noteText, spoken) {
  const question = text.match(/[^.?!]*\?/g)?.join(' ').trim() || null;
  const heard = trigrams(spoken);
  const noteOnly = [...trigrams(noteText.split('\n').slice(1).join(' '))].filter(gram => !heard.has(gram));
  const said = trigrams(text);
  const parroted = noteOnly.filter(gram => said.has(gram));
  const threads = named(text);
  return { text, question, asked: threads[0] ?? null, threads, parroted, parrotShare: said.size ? Math.round(parroted.length / said.size * 100) / 100 : 0, leak: text.match(LEAK)?.[0] ?? null };
}
