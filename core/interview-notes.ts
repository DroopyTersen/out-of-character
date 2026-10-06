import type { ConversationMap, MapEntity, MapThread } from './interview-map';
import { pickThreads, RANKING, threadKey, type Pick, type RankingState } from './interview-ranking';

/**
 * Sam's two notes. Sol writes every content word; code only fills these fixed templates, so no topic label or
 * instruction can leak in. Closed threads never appear: their reasons reach Sam through the vantage and preferences.
 */
export const NOTE_HEADERS = {
  list: 'Thread note. Supersedes earlier thread notes.',
  map: 'Map note. Supersedes earlier map notes.',
};
export type NoteHeaders = typeof NOTE_HEADERS;
/** The live session uses thinking; the delivery probe compares it with appended instructions. */
export const NOTE_CHANNELS = ['session.thinking.append', 'session.instructions.append'] as const;
export type NoteChannel = typeof NOTE_CHANNELS[number];
/** The channel the live session sends notes on. The brief and the producer both default to it, so their wording agrees. */
export const LIVE_NOTE_CHANNEL: NoteChannel = 'session.thinking.append';
/** Appended instructions read as orders, as the old cues did, so on that channel every note says it is only a suggestion. */
const INSTRUCTION_NOTE_HEADERS: NoteHeaders = {
  list: 'Thread note, a suggestion only. Supersedes earlier thread notes.',
  map: 'Map note, background only. Supersedes earlier map notes.',
};
export const noteHeaders = (channel: NoteChannel = LIVE_NOTE_CHANNEL): NoteHeaders =>
  channel === 'session.instructions.append' ? INSTRUCTION_NOTE_HEADERS : NOTE_HEADERS;
export const MAP_NOTE_LIMITS = { known: 6, research: 3 };

/** Sol's text on one line, so nothing it writes can start a line of its own, such as a fake note header, in Sam's note. */
export const oneLine = (text: string) => text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
const sentence = (text: string) => { const line = oneLine(text); return /[.!?]$/.test(line) ? line : `${line}.`; };

const gap = (thread: MapThread) => `still unknown: ${sentence(thread.unknown)}${thread.guess ? ` Guess: ${sentence(thread.guess)}` : ''}`;

/**
 * Sol judged the ground covered: Sam's next turn after an answer offers, once, a real choice between the threads still open and
 * stopping. The note reaches Sam as it starts a turn, so the offer is for the turn after their next answer.
 */
const offerLine = (names: string[]) => `Pace: after their next complete answer, offer once, in place of a new question, to stop here or carry on${names.length ? ` with ${names.join(' or ')}` : ''}. Their call.`;

/**
 * Keep pulling on the current thread, or a thread worth tugging. The runner-up comes with its gap, so Sam has a next
 * question the moment the lead is answered, before a new note can arrive; one more is named by label.
 */
export function listNote(map: ConversationMap, pick: Pick, headers = NOTE_HEADERS, offer = false): string | null {
  const threads = new Map(map.threads.map(thread => [thread.id, thread]));
  const lead = pick.lead == null ? undefined : threads.get(pick.lead);
  if (!lead) return null;
  const [next, ...rest] = pick.nearby.flatMap(id => threads.get(id) ?? []);
  return [
    headers.list,
    ...(offer ? [offerLine([lead, ...(next ? [next] : [])].map(thread => oneLine(thread.label)))] : []),
    `${pick.action === 'keep' ? 'Keep pulling' : 'Worth pulling next'} (${oneLine(lead.label)}): ${gap(lead)}`,
    ...(next ? [`If that’s answered, then (${oneLine(next.label)}): ${gap(next)}`] : []),
    ...(rest.length ? [`${pick.action === 'keep' ? 'Nearby' : 'Also open'}: ${rest.map(thread => oneLine(thread.label)).join(' · ')}`] : []),
  ].join('\n');
}

const labels = (map: ConversationMap, ids: string[]) => ids.flatMap(id => { const thread = map.threads.find(item => item.id === id); return thread ? [oneLine(thread.label)] : []; });

/** Replaces a list note whose lead Sol has since closed, when no open thread is left to pull on. */
export const emptyListNote = (headers = NOTE_HEADERS, offer = false) =>
  [headers.list, ...(offer ? [offerLine([])] : []), 'No open thread right now: follow the participant.'].join('\n');

/** After the participant objects to the interview itself: no thread is pushed, only a few left open if useful. */
export function complaintNote(map: ConversationMap, open: string[], headers = NOTE_HEADERS): string {
  const names = labels(map, open);
  return [
    headers.list,
    'They just gave feedback on the interview itself: acknowledge it in a sentence, adapt, and carry on; don’t dwell on it.',
    ...(names.length ? [`Open threads, if useful: ${names.join(' · ')}`] : []),
  ].join('\n');
}

/** Withdraws the previous note when Sol has removed all its facts, vantage and preferences. */
export const emptyMapNote = (headers = NOTE_HEADERS) => `${headers.map}\nThe previous map facts are withdrawn. Follow what the participant establishes.`;

/** The thread note in force, so a later pick knows what Sam was last told; `named` are the other threads it lists. */
export type ListState = { lead: string | null; key: string | null; sent: boolean; complaint: boolean; named: string[] };
export const emptyListState = (): ListState => ({ lead: null, key: null, sent: false, complaint: false, named: [] });
/** `offer` is whether `text` lets Sam offer to stop. */
export type ListDecision = { pick: Pick; text: string | null; state: ListState; offer: boolean };
const NO_LEAD = '"none"';
const COMPLAINT = '"complaint"';
/** A note is keyed by its lead, that thread's wording and the offer: a new nearby set, or keep versus tug, alone doesn't resend. */
const leadKey = (map: ConversationMap, id: string) => { const thread = map.threads.find(item => item.id === id)!; return JSON.stringify([id, threadKey(thread)]); };
const OFFER = '+offer';

/**
 * The thread note after a settled participant turn (`turn`), or a refresh: a new map, new traits, or a new provider
 * session to restate notes to. Only a turn picks a new lead. A refresh keeps the lead in force, re-sending only when
 * Sol rewrote it, and picks afresh only once Sol has closed it or before any lead, and then only a thread that scored.
 * A note that names a thread the participant has since declined, or Sol has since closed, goes out again without it.
 * A turn in which the participant objected to the interview itself gets an acknowledge-and-adapt note instead, and
 * nothing leads again until their next turn. `offer` lets Sam offer to stop; granting or withdrawing it resends.
 * `state` is what to keep once `text` is sent, or right away when it's null.
 */
export function nextListNote(
  map: ConversationMap, ranking: RankingState, nowMs: number, previous: ListState,
  { turn = false, offer = false, headers = NOTE_HEADERS }: { turn?: boolean; offer?: boolean; headers?: NoteHeaders } = {},
): ListDecision {
  const fresh = pickThreads(map, ranking, nowMs);
  const complaint = turn ? (ranking.reading?.complaint ?? 0) >= RANKING.complaint : previous.complaint;
  // Sam shouldn't be pointed at ground the participant has declined or already answered, even as an aside.
  const gone = (id: string) => map.threads.find(thread => thread.id === id)?.status !== 'open' || ranking.holds[id]?.state === 'declined';
  const stale = previous.named.some(gone);
  const decide = (pick: Pick, key: string, text: string | null, offers = false): ListDecision => {
    const send = key === previous.key && !(stale && text) ? null : text;
    const named = send != null ? pick.nearby : previous.named;
    return { pick, text: send, offer: send != null && offers, state: { lead: pick.lead, key, sent: previous.sent || send != null, complaint, named } };
  };
  if (complaint) {
    const open = fresh.ranked.slice(0, RANKING.nearby).map(item => item.id);
    return decide({ ...fresh, action: 'none', lead: null, nearby: open }, COMPLAINT, complaintNote(map, open, headers));
  }
  const inForce = turn ? undefined : map.threads.find(thread => thread.id === previous.lead && thread.status === 'open');
  let pick: Pick = fresh;
  if (inForce) {
    const others = fresh.ranked.filter(item => item.id !== inForce.id && item.id !== fresh.current);
    pick = { ...fresh, action: fresh.current === inForce.id ? 'keep' : 'tug', lead: inForce.id, nearby: others.slice(0, RANKING.nearby).map(item => item.id) };
  } else if (!turn && !((fresh.ranked.find(item => item.id === fresh.lead)?.score ?? 0) > 0)) {
    pick = { ...fresh, action: 'none', lead: null, nearby: [] };
  }
  const suffix = offer ? OFFER : '';
  if (pick.lead == null) return decide(pick, NO_LEAD + suffix, previous.sent || offer ? emptyListNote(headers, offer) : null, offer);
  return decide(pick, leadKey(map, pick.lead) + suffix, listNote(map, pick, headers, offer), offer);
}

/** The most connected participant facts, in map order, so the note stays short as the map grows. */
function known(map: ConversationMap, source: MapEntity['source'], limit: number): MapEntity[] {
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const edge of map.edges) { bump(edge.from); bump(edge.to); }
  for (const thread of map.threads) if (thread.status === 'open') thread.anchors.forEach(bump);
  const entities = map.entities.filter(item => item.source === source);
  const chosen = new Set([...entities].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || entities.indexOf(a) - entities.indexOf(b)).slice(0, limit));
  return entities.filter(item => chosen.has(item));
}

/** The research facts the map note carries. */
export const mapNoteResearch = (map: ConversationMap): MapEntity[] => known(map, 'research', MAP_NOTE_LIMITS.research);

/** Null while the map has nothing to tell Sam. */
export function mapNote(map: ConversationMap, headers = NOTE_HEADERS): string | null {
  const { vantage, preferences } = map.participant;
  const facts = known(map, 'participant', MAP_NOTE_LIMITS.known);
  const research = mapNoteResearch(map);
  const item = (entity: MapEntity) => `${oneLine(entity.label)}: ${oneLine(entity.detail)}`;
  const lines = [
    ...(oneLine(vantage) ? [`About the participant: ${sentence(vantage)}`] : []),
    ...(preferences.length ? [`They prefer: ${preferences.map(item => sentence(item.text)).join(' ')}`] : []),
    ...(facts.length ? [`Known so far: ${facts.map(item).join(' · ')}`] : []),
    ...(research.length ? [`Public background you read, not project fact: ${research.map(item).join(' · ')}`] : []),
  ];
  return lines.length ? [headers.map, ...lines].join('\n') : null;
}

/** Any change to what the note says. Sol corrects a fact by rewording it, so rewording counts; the producer's spacing keeps it from flooding Sam. */
export const mapNoteKey = (map: ConversationMap): string => mapNote(map) ?? '';
