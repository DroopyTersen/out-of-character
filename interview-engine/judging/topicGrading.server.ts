import { callFailure } from '../providers/diagnostics.server';
import type { FeedbackStatus, InterviewEvaluation } from '../shared/snapshot';
import type { Passage } from '../shared/transcript';
import { gradeObjectives, type GradeRecord } from '../reasoning/conversationRecords';
import { upToParticipant } from '../reasoning/turnTaking';
import { mergeCoverage } from './topicCoverage';

export type TopicGradeInput = { transcript: Passage[]; revision: number };
/** The paid call is substituted in offline tests; grading policy and coverage rules remain real. */
export type Evaluate = (input: TopicGradeInput & { signal: AbortSignal }) => Promise<InterviewEvaluation>;
export type TopicGradingState = {
  evaluation: InterviewEvaluation | null;
  feedbackStatus: FeedbackStatus;
  grades: GradeRecord[];
  gradeCalls: number;
};

type TopicGradingOptions = {
  evaluate: Evaluate;
  now: () => number;
  current: () => TopicGradeInput;
  freeze: (passages: readonly Passage[]) => void;
};

const GRADE_INTERVAL_MS = 5000;
const MAX_LIVE_GRADES = 719; // Assessment rounds; the final grade is additional.
/** Keep answered questions and corrections; a trailing interviewer turn adds no participant evidence. */
function gradingText(transcript: Passage[]): string {
  const answered = upToParticipant(transcript);
  return answered.length ? JSON.stringify(answered.map(({ id, speaker, text }) => [id, speaker, text])) : '';
}

/** Owns live/final topic grading. The coordinator controls lifecycle, settled evidence, and durable persistence. */
export class TopicGrading {
  private state: TopicGradingState = { evaluation: null, feedbackStatus: 'waiting', grades: [], gradeCalls: 0 };
  private lastGrade = 0;
  private gradedText = '';
  private retriedText = '';
  private running: Promise<void> | undefined;
  private abort: AbortController | undefined;

  constructor(private readonly options: TopicGradingOptions) {}

  /** Read-only view; persistence takes its detached copy at the coordinator's storage seam. */
  snapshot(): Readonly<TopicGradingState> { return this.state; }

  /** Restore before running; only durable state survives, never a pending call or retry. */
  restore(saved: TopicGradingState): void { this.state = saved; }

  tick(): Promise<void> | undefined {
    const input = this.options.current(), now = this.options.now();
    const text = gradingText(input.transcript);
    if (this.state.evaluation && text !== this.gradedText) this.state.feedbackStatus = 'delayed';
    if (!text || this.running || text === this.gradedText || now - this.lastGrade < GRADE_INTERVAL_MS || this.state.gradeCalls >= MAX_LIVE_GRADES) return;
    this.lastGrade = now;
    this.gradedText = text;
    return this.run(input, false);
  }

  /** Abort immediately; the caller decides when lifecycle ordering permits awaiting settlement. */
  stop(): Promise<void> {
    this.abort?.abort();
    return this.running ?? Promise.resolve();
  }

  final(input: TopicGradeInput): Promise<void> {
    if (!input.transcript.some(passage => passage.speaker === 'participant')) return Promise.resolve();
    return this.run(input, true, this.stop());
  }

  private run(input: TopicGradeInput, final: boolean, previous?: Promise<void>): Promise<void> {
    const abort = new AbortController();
    // Register final cancellation before waiting for live work. An old completion cannot clear its successor.
    this.abort = abort;
    const work = async () => {
      if (previous) await previous;
      if (abort.signal.aborted) return;
      this.options.freeze(input.transcript);
      await this.grade(input, final, abort);
    };
    return this.running = work().finally(() => {
      if (this.abort !== abort) return;
      this.running = undefined;
      this.abort = undefined;
    });
  }

  private async grade({ transcript, revision }: TopicGradeInput, final: boolean, abort: AbortController) {
    const state = this.state;
    const diagnostic = { source: 'grade' as const, id: `grade-${++state.gradeCalls}`, final, revision, capturedAt: this.options.now(),
      inputCount: transcript.length, lastInputId: transcript.at(-1)?.id ?? null };
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(final ? 8000 : 3000)]);
    try {
      const result = await this.options.evaluate({ transcript, revision, signal });
      signal.throwIfAborted();
      const log = { ...diagnostic, completedAt: this.options.now(), durationMs: result.durationMs };
      if (revision < (state.evaluation?.revision ?? 0)) {
        state.grades.push({ ...log, outcome: 'stale', objectives: gradeObjectives(result.objectives, state.evaluation?.objectives ?? []) });
        return;
      }
      const objectives = final ? result.objectives : mergeCoverage(state.evaluation?.objectives ?? [], result.objectives);
      state.grades.push({ ...log, outcome: 'graded', objectives: gradeObjectives(result.objectives, objectives) });
      state.evaluation = { revision: result.revision, model: result.model, durationMs: result.durationMs, objectives };
      state.feedbackStatus = final || gradingText(transcript) === gradingText(this.options.current().transcript) ? 'current' : 'delayed';
    } catch (error) {
      state.grades.push({ ...diagnostic, completedAt: this.options.now(), failure: callFailure(error),
        outcome: abort.signal.aborted ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'evaluation_timeout' : 'evaluation_error' });
      if (abort.signal.aborted) return;
      state.feedbackStatus = state.evaluation ? 'delayed' : 'unavailable';
      // One cadence-limited retry per participant input, still inside the paid-call cap.
      if (!final && this.retriedText !== this.gradedText) {
        this.retriedText = this.gradedText;
        this.gradedText = '';
      }
    }
  }
}
