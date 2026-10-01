import type { ConversationMap, MapEntity } from './interview-map';
import { threadKey, type Pick } from './interview-ranking';

/**
 * Sam's two notes. Sol writes every content word; code only fills these fixed templates, so no topic label or
 * instruction can leak in. Closed threads never appear: their reasons reach Sam through the vantage and preferences.
 */
export const NOTE_HEADERS = {
  list: 'Thread note. Supersedes earlier thread notes.',
  map: 'Map note. Supersedes earlier map notes.',
};
export const MAP_NOTE_LIMITS = { known: 6, research: 3 };

/** Sol's text on one line, so nothing it writes can start a line of its own, such as a fake note header, in Sam's note. */
export const oneLine = (text: string) => text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
const sentence = (text: string) => { const line = oneLine(text); return /[.!?]$/.test(line) ? line : `${line}.`; };

/** Keep pulling on the current thread, or a thread worth tugging, plus up to two others by label. */
export function listNote(map: ConversationMap, pick: Pick): string | null {
  const threads = new Map(map.threads.map(thread => [thread.id, thread]));
  const lead = pick.lead == null ? undefined : threads.get(pick.lead);
  if (!lead) return null;
  const nearby = pick.nearby.flatMap(id => { const thread = threads.get(id); return thread ? [oneLine(thread.label)] : []; });
  return [
    NOTE_HEADERS.list,
    `${pick.action === 'keep' ? 'Keep pulling' : 'Worth pulling next'} (${oneLine(lead.label)}): still unknown: ${sentence(lead.unknown)}${lead.guess ? ` Guess: ${sentence(lead.guess)}` : ''}`,
    ...(nearby.length ? [`${pick.action === 'keep' ? 'Nearby' : 'Also open'}: ${nearby.join(' · ')}`] : []),
  ].join('\n');
}

/** A new list note goes out only when the pick moves or Sol rewrites the lead; the nearby threads changing alone isn't worth one. */
export function listNoteKey(map: ConversationMap, pick: Pick): string {
  const lead = map.threads.find(thread => thread.id === pick.lead);
  return JSON.stringify([pick.action, pick.current, pick.lead, lead ? threadKey(lead) : null]);
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

/** Null while the map has nothing to tell Sam. */
export function mapNote(map: ConversationMap): string | null {
  const { vantage, preferences } = map.participant;
  const facts = known(map, 'participant', MAP_NOTE_LIMITS.known);
  const research = known(map, 'research', MAP_NOTE_LIMITS.research);
  const item = (entity: MapEntity) => `${oneLine(entity.label)}: ${oneLine(entity.detail)}`;
  const lines = [
    ...(oneLine(vantage) ? [`About the participant: ${sentence(vantage)}`] : []),
    ...(preferences.length ? [`They prefer: ${preferences.map(item => sentence(item.text)).join(' ')}`] : []),
    ...(facts.length ? [`Known so far: ${facts.map(item).join(' · ')}`] : []),
    ...(research.length ? [`Public background you read, not project fact: ${research.map(item).join(' · ')}`] : []),
  ];
  return lines.length ? [NOTE_HEADERS.map, ...lines].join('\n') : null;
}

/** Material change: a new vantage, a preference from a new passage, or a different set of facts. Rewording isn't worth a note. */
export function mapNoteKey(map: ConversationMap): string {
  const ids = (source: MapEntity['source'], limit: number) => known(map, source, limit).map(item => item.id).join(',');
  return JSON.stringify([map.participant.vantage, map.participant.preferences.map(item => item.passageId).join(','), ids('participant', MAP_NOTE_LIMITS.known), ids('research', MAP_NOTE_LIMITS.research)]);
}
