import { WINDOW_SECONDS, type SpokenWord } from '../../core/performance';

export type TranscriptSegment = {
  id: string;
  text: string;
  start: number;
  end: number;
  final: boolean;
  stable?: boolean;
  words?: SpokenWord[];
  fullWords?: SpokenWord[];
};
export type FluxTurnInfo = {
  type: 'TurnInfo';
  event: 'Update' | 'StartOfTurn' | 'EndOfTurn';
  turn_index: number;
  transcript: string;
  words: { word: string; start: number; end: number; confidence?: number }[];
};
type TimedWord = SpokenWord & { changedAt: number };
export type FluxTurn = {
  id: string;
  text: string;
  words: TimedWord[];
  final: boolean;
  withdrawal?: { words: number; at: number };
};
export const SETTLE_SECONDS = 0.4;
export const emptyTurn = (id: string): FluxTurn => ({ id, text: '', words: [], final: false });
const spelling = (text: string) => text.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}']/gu, '');
const timestamp = (value: number) => {
  if (!Number.isFinite(value) || value < -0.001 || value > 601) throw new Error('Speech returned an invalid word timestamp. Try listening again.');
  return Math.round(Math.max(0, value) * 1000) / 1000;
};

/** Flux timestamps refer to submitted audio. Unchanged lexical words retain their settling age while their audio times
 * refine. Timing never follows event arrival; float noise rounds away. */
export function observeTurn(previous: FluxTurn, event: FluxTurnInfo, now: number): FluxTurn {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid speech observation time.');
  if (!Number.isInteger(event.turn_index) || event.turn_index < 0 || !['Update', 'StartOfTurn', 'EndOfTurn'].includes(event.event) || typeof event.transcript !== 'string' || !Array.isArray(event.words)) throw new Error('Speech returned an invalid transcript. Try listening again.');
  const incoming = event.words.flatMap(word => {
    if (typeof word.word !== 'string') throw new Error('Speech returned an invalid word. Try listening again.');
    if (!spelling(word.word)) return [];
    const start = timestamp(word.start);
    const end = timestamp(word.end);
    if (end < start) throw new Error('Speech returned an invalid word timestamp. Try listening again.');
    return [{ text: word.word, start, end, changedAt: now }];
  });
  if (event.transcript.length > 80000 || incoming.length > 10000) throw new Error('Listening reached the transcript limit. Restart listening to continue.');
  if (previous.final && event.event !== 'EndOfTurn') return previous;
  let prefix = 0;
  while (prefix < Math.min(incoming.length, previous.words.length) && spelling(incoming[prefix]!.text) === spelling(previous.words[prefix]!.text)) prefix++;
  let suffix = 0;
  while (suffix < Math.min(incoming.length, previous.words.length) - prefix && spelling(incoming[incoming.length - 1 - suffix]!.text) === spelling(previous.words[previous.words.length - 1 - suffix]!.text)) suffix++;
  const words = incoming.map((word, index) => {
    const prior = index < prefix ? previous.words[index] : index >= incoming.length - suffix ? previous.words[previous.words.length - incoming.length + index] : undefined;
    if (!prior) return word;
    // Timing refinement does not make unchanged recognized content provisional.
    return { ...word, text: prior.text, changedAt: prior.changedAt };
  });
  const next = { id: previous.id, text: event.transcript, words, final: event.event === 'EndOfTurn' };
  if (!next.final && incoming.length < previous.words.length && prefix === incoming.length) {
    return { ...next, words: previous.words, withdrawal: { words: incoming.length, at: previous.withdrawal?.words === incoming.length ? previous.withdrawal.at : now } };
  }
  return next;
}

/** Settled prefixes enter scoring after 400ms; the last interim word is pending. */
export function settledTranscript(state: FluxTurn, now: number): TranscriptSegment {
  const observed = state.withdrawal && now - state.withdrawal.at >= SETTLE_SECONDS ? state.words.slice(0, state.withdrawal.words) : state.words;
  const words: SpokenWord[] = [];
  const fullWords: SpokenWord[] = [];
  for (let index = 0; index < observed.length; index++) {
    const word = observed[index]!;
    const pending = !state.final && (index === observed.length - 1 || now - word.changedAt < SETTLE_SECONDS);
    // Old corrections invalidate full context without hiding fresh suffix words.
    if (pending) {
      if (word.end <= now - WINDOW_SECONDS) continue;
      break;
    }
    const settled = { text: word.text, start: word.start, end: word.end };
    fullWords.push(settled);
    if (word.end > now - WINDOW_SECONDS) words.push(settled);
  }
  return { id: state.id, text: state.text, start: observed[0]?.start ?? 0, end: observed.at(-1)?.end ?? 0, final: state.final, stable: fullWords.length > 0, words, fullWords };
}
