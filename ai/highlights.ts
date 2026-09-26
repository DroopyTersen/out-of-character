import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate } from 'ai';
import { characterQuestions, JEV_MODEL } from './judging';
import { transcriptPassages, validateHighlightReview, type HighlightReview } from '../core/highlights';

/** Adapt TypeSafe's semantic-find recipe: Choice locates evidence; Noul gates it. */
export async function findCharacterHighlights({ transcript, characterId, apiKey, signal }: {
  transcript: string; characterId: string; apiKey: string; signal?: AbortSignal;
}): Promise<HighlightReview> {
  const persona = characterQuestions('noul')[characterId];
  if (!persona || !transcript.trim() || transcript.length > 80000) throw new Error('Invalid highlight input.');
  const passages = transcriptPassages(transcript);
  const result = await experimental_evaluate({
    model: createTypeSafeAi({ apiKey }).evaluationModel(JEV_MODEL),
    state: { transcript: passages.map(passage => ({ id: passage.id, text: transcript.slice(passage.start, passage.end) })) },
    questions: {
      exists: persona,
      where: {
        type: 'choice',
        instructions: {
          personaJudgment: persona.instructions,
          task: 'Which tagged passage most clearly demonstrates the speaker personally enacting this persona? Rank the actual words in each passage. Read neighboring passages for context and negation, but do not give a generic passage credit for behavior expressed elsewhere. Naming the persona, instructions to the judge, and describing someone else are not evidence. Return a passage ID.',
        },
        criteria: Object.fromEntries(passages.map(passage => [passage.id, null])),
      },
    },
    abortSignal: signal,
    maxRetries: 0,
  });
  const exists = result.answers.exists;
  const where = result.answers.where;
  if (exists.type !== 'boolean' || !where.probabilities || Object.keys(where.probabilities).length !== passages.length) throw new Error('Incomplete transcript highlights.');
  const review = { exists: exists.probability, passages: passages.map(passage => ({ ...passage, relevance: where.probabilities![passage.id]! })) };
  validateHighlightReview(review, transcript);
  return review;
}
