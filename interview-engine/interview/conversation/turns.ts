// Turn heuristics read from the transcript alone: whether a passage hands back the floor, finishes a turn, or asks to end.

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

/** The participant's words without transcribed noises such as "[sniff]" or "tongue click". */
export const spokenWords = (text: string) => text.replace(/\[[^\]]*(?:\]|$)/g, ' ').replace(/\btongue click\b/gi, ' ').replace(/\s+/g, ' ').trim();
const THINKING = /^(?:hmm+|um+|uh+|er+|mm+)[.!?,…]*$/i;
const UNFINISHED = /(?:\b(?:and|but|so|because|or|like|um+|uh+|er+|the|a|an|to|of|for|with|that|which|if|when|then|kind of|sort of)|[,;:…]|\.\.\.|[-–—])$/i;
const HOLDING = /\b(?:let me (?:think|see|check|find|look)|hold on|hang on|give me a (?:sec(?:ond)?|minute|moment)|one sec(?:ond)?|just a (?:sec(?:ond)?|moment|minute))\b/i;
/** Whether the participant's latest words read as a finished turn: not a thinking sound, a clause left hanging, or a request for time. */
export function finishesTurn(text: string): boolean {
  const words = spokenWords(text);
  return !!words && !THINKING.test(words) && !UNFINISHED.test(words) && !HOLDING.test(words);
}

const ENDING = /\b(?:(?:can|could) we (?:be done|stop|wrap|end|finish)|let['’]?s (?:stop|wrap|end|finish|be done|call it)|(?:i|we) (?:need|have|got) to (?:go|run|stop)|gotta go|i['’]m done|we['’]re done|stop here|wrap (?:it |this )?up|end (?:the|this) (?:interview|call|conversation))\b/i;
/** Whether the participant asks to finish the interview. */
export const asksToEnd = (text: string) => ENDING.test(spokenWords(text));
