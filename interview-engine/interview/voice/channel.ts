/** The live session sends Sam's private notes on thinking; the delivery probe compares appended instructions. */
export const NOTE_CHANNELS = ['session.thinking.append', 'session.instructions.append'] as const;
export type NoteChannel = typeof NOTE_CHANNELS[number];
/** The channel the live session sends notes on. The brief and the producer both default to it, so their wording agrees. */
export const LIVE_NOTE_CHANNEL: NoteChannel = 'session.thinking.append';
