// The rubric moved to the engine; the archive and the probes read its version from here.
import { interviewQuestions as questions } from '../../interview-engine/interview/conversation/rubric.prompt';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec } from '../../interviews/project-closeout/spec';

export { INTERVIEW_RUBRIC_VERSION } from '../../interview-engine/interview/conversation/rubric.prompt';

export const interviewQuestions = (entries: Passage[]) =>
  questions(spec, entries.map(({ id, speaker, text, startMs, endMs }) => ({ id, speaker: speaker === 'participant' ? 'participant' : 'interviewer', text, startMs, endMs })));
