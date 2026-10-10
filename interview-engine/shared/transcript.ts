export type Speaker = 'participant' | 'interviewer';
/** One passage of speech. Times are milliseconds on the attempt's conversation clock. */
export type Passage = { id: string; speaker: Speaker; text: string; startMs: number; endMs: number };
/** A quoted passage supporting a reading. The default speaker type is the canonical interview role. */
export type Evidence<S extends string = Speaker> = { entryId: string; speaker: S; text: string };

/** Evaluator input bound. A live session stops accepting speech beyond it so final grading stays valid. */
export const TRANSCRIPT_LIMIT = { entries: 800, characters: 80_000 };
export const transcriptCharacters = (passages: readonly Pick<Passage, 'text'>[]) => passages.reduce((sum, passage) => sum + passage.text.length, 0);

export function findEvidence(passages: Passage[], id: string): Evidence | null {
  const passage = passages.find(item => item.id === id);
  return passage ? { entryId: passage.id, speaker: passage.speaker, text: passage.text } : null;
}

/** The dialogue as topic and conversation-turn judgments sees it, rendered the same way each time, with the interviewer's speaker token. */
export function dialogueState(passages: Pick<Passage, 'id' | 'speaker' | 'text'>[], interviewer = 'interviewer') {
  return { dialogueColumns: ['id', 'speaker', 'text'], dialogue: passages.map(({ id, speaker, text }) => [id, speaker === 'participant' ? 'participant' : interviewer, text]) };
}
