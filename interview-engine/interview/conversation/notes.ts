import type { ConversationMap, MapEntity, MapThread } from './map';
import { pickThreads, RANKING, threadKey, type Pick, type RankingState } from './ranking';

/** Private suggestions for Sam; never appended to its instructions. */
export const LIVE_NOTE_CHANNEL = 'session.thinking.append';

/** Sol supplies content; code supplies the same two templates on every interview. */
export const NOTE_HEADERS = {
  list: 'Thread note. Supersedes earlier thread notes.',
  map: 'Map note. Supersedes earlier map notes.',
};
export const MAP_NOTE_LIMITS = { known: 6, research: 3 };

/** Sol's text cannot start another line, such as a fake note header. */
export const oneLine = (text: string) => text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
const sentence = (text: string) => { const line = oneLine(text); return /[.!?]$/.test(line) ? line : `${line}.`; };
const gap = (thread: MapThread) => `still unknown: ${sentence(thread.unknown)}${thread.guess ? ` Guess: ${sentence(thread.guess)}` : ''}`;

export function listNote(map: ConversationMap, pick: Pick): string | null {
  const lead = map.threads.find(thread => thread.id === pick.lead && thread.status === 'open');
  if (!lead) return null;
  const nearby = pick.nearby.flatMap(id => map.threads.find(thread => thread.id === id && thread.status === 'open') ?? []).slice(0, RANKING.nearby);
  return [
    NOTE_HEADERS.list,
    `${pick.action === 'keep' ? 'Keep pulling' : 'Worth pulling next'} (${oneLine(lead.label)}): ${gap(lead)}`,
    ...(nearby.length ? [`Nearby: ${nearby.map(thread => oneLine(thread.label)).join(' · ')}`] : []),
  ].join('\n');
}

export const emptyListNote = () => `${NOTE_HEADERS.list}\nNo open thread right now: follow the participant.`;
export const emptyMapNote = () => `${NOTE_HEADERS.map}\nThe previous map facts are withdrawn. Follow what the participant establishes.`;
export type ListState = { key: string | null; sent: boolean; named: string[] };
export const emptyListState = (): ListState => ({ key: null, sent: false, named: [] });
export type ListDecision = { pick: Pick; text: string | null; state: ListState };

/** Only a changed lead or its wording sends a cue, unless a named alternative has become unavailable. */
export function nextListNote(map: ConversationMap, ranking: RankingState, previous: ListState): ListDecision {
  const pick = pickThreads(map, ranking);
  const lead = map.threads.find(thread => thread.id === pick.lead);
  const key = lead ? JSON.stringify([lead.id, threadKey(lead)]) : 'none';
  const stale = previous.named.some(id => !pick.ranked.some(item => item.id === id));
  const text = key === previous.key && !stale ? null : lead ? listNote(map, pick) : previous.sent ? emptyListNote() : null;
  return { pick, text, state: { key, sent: previous.sent || text != null, named: text ? pick.nearby : previous.named } };
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
export function mapNote(map: ConversationMap): string | null {
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
  return lines.length ? [NOTE_HEADERS.map, ...lines].join('\n') : null;
}

/** Any change to what the note says. Sol corrects a fact by rewording it, so rewording counts; unchanged notes are never resent. */
export const mapNoteKey = (map: ConversationMap): string => mapNote(map) ?? '';
