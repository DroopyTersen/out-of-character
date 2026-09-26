import {
  simulatorFixtures as development,
  simulatorHoldouts,
  simulatorValidation,
  dialogue,
  type SimulatorFixture,
} from '../../ai/simulator/fixtures';
import holdouts from '../../ai/simulator/holdout-results.json';
import validation from '../../ai/simulator/validation-results.json';
import results from '../../ai/simulator/results.json';
import replay from '../../ai/simulator/replay.json';
import { reconcileObjectives } from '../../core/simulator/state';
import type { Catalog, SessionSnapshot, TraineeEvaluation } from '../../core/simulator/types';

type RecordedRow = {
  source: { file: string; collectedAt: string; rubricVersion: string };
  fixtureId: string;
  transcriptLength: number;
  trainee: TraineeEvaluation & { answers: unknown };
  client: {
    fidelity: number;
    interests: number[];
    cueId: string;
    cueProbability: number;
    durationMs: number;
    answers: unknown;
  };
  checks: { name: string; passed: boolean }[];
};

export const simulatorFixtures = [...development, ...simulatorHoldouts, ...simulatorValidation];

/** Illustrative social dialogue; deliberately has no judging recording. */
export const happyHourFixture: SimulatorFixture = {
  id: 'happy-hour', title: 'Happy hour · open conversation', scenarioId: 'happy-hour', clientId: 'jamie',
  description: 'An informal conversation with no agenda or scoring.',
  transcript: dialogue([
    ['client', 'Hi, I’m Jamie. They really went all out with the snacks. I’m trying to decide if this tiny plate is a suggestion or a rule.'],
    ['trainee', 'Definitely a suggestion. What do you like doing when you’re off the clock?'],
    ['client', 'Oh, I love a good walk. My friend calls our route a hike, which is very generous when it ends at a bakery.'],
  ]),
  expected: { achieved: [], absent: [] },
};

function recorded(source: typeof results | typeof holdouts | typeof validation | typeof replay, file: string) {
  // JSON imports widen literals such as Evidence.speaker. Narrow once at this
  // checked-in recording boundary; raw provider answers are only displayed.
  return source.rows.map((row) => ({
    ...row,
    source: { file, collectedAt: source.collectedAt, rubricVersion: source.rubricVersion },
  })) as RecordedRow[];
}

const measured = [
  ...recorded(results, 'results.json'),
  ...recorded(holdouts, 'holdout-results.json'),
  ...recorded(validation, 'validation-results.json'),
];
const recordedSteps = recorded(replay, 'replay.json');

/** One checkpoint selection supplies both the screen assessment and lab diagnostics. */
export function recordedAttempt(catalog: Catalog, fixture: SimulatorFixture, count: number) {
  const scenario = catalog.scenarios.find((item) => item.id === fixture.scenarioId)!;
  const client = catalog.clients.find((item) => item.id === fixture.clientId)!;
  const steps = recordedSteps.filter((row) => row.fixtureId === fixture.id);
  const final = measured.find((row) => row.fixtureId === fixture.id);
  const relevant = steps.filter((row) => row.transcriptLength <= count);
  if (!relevant.length && count === fixture.transcript.length && final) relevant.push(final);
  const recording = relevant.at(-1);
  const nextRecorded =
    steps
      .filter((row) => row.transcriptLength > count)
      .map((row) => row.transcriptLength)
      .sort((a, b) => a - b)[0] ?? final?.transcriptLength;

  const evaluation = relevant.reduce<TraineeEvaluation | null>(
    (previous, row) => ({
      ...row.trainee,
      objectives: reconcileObjectives(scenario, previous?.objectives ?? [], row.trainee.objectives),
    }),
    null,
  );
  const snapshot: SessionSnapshot = {
    id: 'workshop-attempt',
    scenarioId: scenario.id,
    clientId: fixture.clientId,
    status: 'live',
    startedAt: 0,
    limitSeconds: 600,
    revision: count,
    transcript: fixture.transcript.slice(0, count),
    evaluation,
    feedbackStatus: evaluation ? (evaluation.revision < count ? 'delayed' : 'current') : 'waiting',
    message: null,
    finalization: 'pending',
    usageSeconds: null,
  };
  return { scenario, client, snapshot, recording, nextRecorded };
}
