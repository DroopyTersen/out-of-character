import type { Passage as TranscriptEntry } from '../../shared/transcript';

// Turn heuristics read from the transcript alone: whether Sam's passage hands back the floor.

const BACKCHANNEL = /^(?:mm+(?:[- ]?hm*)?|hmm+|uh[- ]?huh|ah+|oh+|['’]?kay|yeah|yep|yes|no|right|okay|ok|sure)[.!?]*$/i;
export const isBackchannel = (text: string) => BACKCHANNEL.test(text.trim());

const YIELD = /\b(?:go on|go ahead|keep going|carry on|please continue|i['’]m listening|sorry|after you|you go|i thought you were (?:done|finished))\b/i;
/**
 * Whether Sam's passage hands the floor back rather than taking a turn: a backchannel, a few words that aren't a question,
 * or an apology or go-ahead. The voice model often starts into a pause and stops ("Oh,", "I mean,", "Sorry, go ahead."),
 * and the participant's next words carry on the same turn.
 */
export function yieldsTurn(text: string): boolean {
  const words = text.replace(/\[[^\]]*\]/g, ' ').replace(/[\s,;:\-–—…]+$/u, '').trim();
  if (!words || isBackchannel(words)) return true;
  if (words.endsWith('?')) return false;
  const count = words.split(/\s+/).length;
  return count <= 6 || (count <= 12 && YIELD.test(words));
}

const SHORT_ANSWER = /^(?:yes|yeah|yep|no|nope|sure|right|uh[- ]?huh)[.!]*$/i;

/** Short confirmations can answer a question or a declarative guess. Transcript punctuation cannot decide that. */
export function said(transcript: TranscriptEntry[], index: number) {
  const entry = transcript[index]!;
  if (entry.speaker !== 'participant') return false;
  if (!isBackchannel(entry.text)) return true;
  const before = transcript[index - 1];
  return SHORT_ANSWER.test(entry.text.trim()) && before?.speaker === 'interviewer' && !isBackchannel(before.text);
}

/**
 * The participant passages since Sam last took a turn, keeping those that say something: the turn being read. Sam's
 * backchannels and yields don't end it, so a participant who resumes after one regrows the same turn.
 */
export function latestTurn(transcript: TranscriptEntry[]): TranscriptEntry[] {
  let start = transcript.length;
  while (start > 0 && (transcript[start - 1]!.speaker === 'participant' || yieldsTurn(transcript[start - 1]!.text))) start--;
  return transcript.flatMap((entry, index) => index >= start && said(transcript, index) ? [entry] : []);
}

/** The transcript up to the participant's last words, so a turn is still read once Sam has started to reply. */
export function upToParticipant(transcript: TranscriptEntry[]): TranscriptEntry[] {
  return transcript.slice(0, transcript.findLastIndex((_, index) => said(transcript, index)) + 1);
}
