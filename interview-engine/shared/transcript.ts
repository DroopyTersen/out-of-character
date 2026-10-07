export type Speaker = 'participant' | 'interviewer';
/** One passage of speech. Times are milliseconds on the attempt's conversation clock. */
export type Passage = { id: string; speaker: Speaker; text: string; startMs: number; endMs: number };
/** A quoted passage supporting a reading. Generic in the speaker while the running code still uses the practice simulator's names. */
export type Evidence<S extends string = Speaker> = { entryId: string; speaker: S; text: string };

/** Evaluator input bound. A live session stops accepting speech beyond it so final grading stays valid. */
export const TRANSCRIPT_LIMIT = { entries: 800, characters: 80_000 };
export const transcriptCharacters = (passages: readonly Pick<Passage, 'text'>[]) => passages.reduce((sum, passage) => sum + passage.text.length, 0);

export function findEvidence(passages: Passage[], id: string): Evidence | null {
  const passage = passages.find(item => item.id === id);
  return passage ? { entryId: passage.id, speaker: passage.speaker, text: passage.text } : null;
}
