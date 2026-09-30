import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluateClient, evaluateTrainee } from './evaluate.server';
import { evaluateInterview, evaluateInterviewer } from '../interview/evaluate.server';
import { generateProducer } from '../interview/producer.server';
import { interviewFixtures } from '../interview/fixtures';
import { INTERVIEW_SCENARIO_ID } from '../../core/interview';
import { generateDirector } from './director.server';
import { foundryConfig } from '../foundry.server';
import { simulatorFixtures, simulatorHoldouts, simulatorValidation } from './fixtures';
import { simulatorChallenges } from './challenge-fixtures';
import { simulatorBlindFixtures } from './blind-fixtures';
import { simulatorCatalogFixtures } from './catalog-fixtures';
import { DirectorGate, DIRECTOR_VERSION, type DirectorAudience, type DirectorSignal } from '../../core/simulator/director';
import { CHECK_IN_SIGNALS, PRODUCER_LIMITS, PRODUCER_VERSION, PROTECTION_CONDITIONS, type ProducerRecord, type ProducerTrigger } from '../../core/interview-producer';
import { JEV_MODEL } from '../judging';

// This opt-in development replay uses synthetic fixtures. It is not a live
// latency/actor-compliance test or a substitute for the held-out release gates.
if (!process.argv.includes('--paid')) throw new Error('Pass --paid and --fixture=<id> to run a bounded provider replay.');
const id = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
const interviewFixture = interviewFixtures.find(item => item.id === id);
const simulatorFixture = [...simulatorFixtures, ...simulatorHoldouts, ...simulatorValidation, ...simulatorChallenges, ...simulatorBlindFixtures, ...simulatorCatalogFixtures].find(item => item.id === id);
const fixture = interviewFixture ?? simulatorFixture;
if (!fixture) throw new Error('Select a known synthetic fixture with --fixture=<id>.');
const foundry = foundryConfig(process.env);
if (!process.env.TYPESAFE_API_KEY) throw new Error('Load the existing server credentials with --env-file=.dev.vars.');
const compare = process.argv.includes('--compare');
const turns = process.argv.includes('--every-turn') ? fixture.transcript.map((_, index) => index + 1).filter(length => fixture.transcript.slice(0, length).some(entry => entry.speaker === 'trainee')) : [fixture.transcript.length];
if (turns.length > 24) throw new Error('Replay is limited to 24 snapshots; choose a shorter fixture.');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || `output/director-replay-${fixture.id}.json`;
const report = { synthetic: true, fixture: fixture.id, kind: interviewFixture ? 'interview' : 'simulator', collectedAt: new Date().toISOString(), version: interviewFixture ? PRODUCER_VERSION : DIRECTOR_VERSION, models: { detector: JEV_MODEL, director: foundry.agentModel }, compare, rows: [] as Record<string, unknown>[] };
const gate = new DirectorGate();

/** The interview replays one producer check-in per snapshot, with any signals as reasons. Research is not looked up. */
async function replayInterview(turn: number) {
  const transcript = fixture!.transcript.slice(0, turn);
  const input = { scenarioId: INTERVIEW_SCENARIO_ID, clientId: 'sam-cedar', transcript, revision: turn, apiKey: process.env.TYPESAFE_API_KEY!, signal: AbortSignal.timeout(30_000) };
  const [interviewer, graded] = await Promise.all([evaluateInterviewer({ ...input, deliveredBackground: interviewFixture!.deliveredBackground, cue: interviewFixture!.cue }), evaluateInterview(input)]);
  const probability = (condition: string) => { const signal = interviewer.signals.find(item => item.condition === condition); return signal && 'probability' in signal ? signal.probability : 0; };
  const triggers: ProducerTrigger[] = [
    ...PROTECTION_CONDITIONS.filter(condition => probability(condition) >= .6).map(condition => ({ kind: 'concern' as const, condition, probability: probability(condition) })),
    { kind: 'check-in' },
    ...Object.entries(CHECK_IN_SIGNALS).flatMap(([condition, threshold]) => {
      const value = condition === 'research' ? interviewer.researchProbability ?? 0 : probability(condition);
      return value >= threshold ? [{ kind: 'signal' as const, condition: condition as keyof typeof CHECK_IN_SIGNALS, probability: value }] : [];
    }),
  ];
  const row: Record<string, unknown> = { turn, audience: 'producer', signals: interviewer.signals, researchProbability: interviewer.researchProbability, triggers,
    coverage: graded.objectives.map(({ id, level }) => ({ id, level })), detectorDurationMs: interviewer.durationMs, detectorUsage: interviewer.usage, eligible: true, generation: [] };
  report.rows.push(row);
  const now = transcript.at(-1)!.endMs;
  // A fixture's earlier direction reaches Sol as a sent past cue with Jev's follow-through judgment.
  const cue = interviewFixture!.cue;
  const history: ProducerRecord[] = cue && transcript.some(entry => entry.id === cue.afterPassageId) ? [{
    source: 'producer', id: cue.id, triggers: [{ kind: 'check-in' }], queued: false, model: 'fixture', effort: 'none', inputCount: 0, lastInputId: cue.afterPassageId,
    triggeredAt: cue.endMs, startedAt: cue.endMs, sentAt: cue.endMs, result: { cue: cue.text, evidenceIds: cue.evidenceIds, research: null }, outcome: 'sent',
    ...(interviewer.followThrough ? { followThrough: { ...interviewer.followThrough, lastInputId: transcript.at(-1)!.id } } : {}),
  }] : [];
  row.pastCue = history[0] ? { text: cue!.text, followThrough: interviewer.followThrough?.outcome ?? null } : null;
  for (const effort of compare ? ['low', 'medium'] as const : ['low'] as const) {
    const started = performance.now();
    const result = await generateProducer({ clientId: 'sam-cedar', transcript, coverage: graded.objectives, startedAt: 0, now, triggers, history,
      budget: { cuesLeft: PRODUCER_LIMITS.cues, researchLeft: PRODUCER_LIMITS.research, lookupsInFlight: 0 }, foundry, signal: AbortSignal.timeout(20_000) }, fetch, effort);
    const durationMs = Math.round(performance.now() - started);
    (row.generation as unknown[]).push({ effort, durationMs, ...result });
  }
}

try {
  if (interviewFixture) for (const turn of turns) await replayInterview(turn);
  else for (const turn of turns) {
    const transcript = fixture.transcript.slice(0, turn);
    const scenarioId = simulatorFixture!.scenarioId;
    const clientId = simulatorFixture!.clientId;
    const input = { scenarioId, clientId, transcript, revision: turn, apiKey: process.env.TYPESAFE_API_KEY!, signal: AbortSignal.timeout(30_000) };
    const [trainee, actor] = await Promise.all([evaluateTrainee(input), evaluateClient(input)]);
    const audiences: { audience: DirectorAudience; signals: DirectorSignal[]; durationMs: number; usage: unknown }[] = [
      { audience: 'trainee', signals: trainee.signals, durationMs: trainee.durationMs, usage: trainee.usage }, { audience: 'actor', signals: actor.signals, durationMs: actor.durationMs, usage: actor.usage }];
    for (const { audience, signals, durationMs, usage } of audiences) {
      gate.observe(audience, signals);
      const now = transcript.at(-1)!.endMs;
      // Keep negative and suppressed windows: reviewing only generated output
      // conceals gate false negatives. Human labels belong in a separate report.
      const row: Record<string, unknown> = { turn, audience, signals, eligible: false, issueId: null, detectorDurationMs: durationMs, detectorUsage: usage, generation: [] };
      report.rows.push(row);
      const review = gate.review(audience, now, turn, async issue => {
        row.eligible = true;
        row.issueId = issue.id;
        for (const effort of compare ? ['low', 'medium'] as const : ['low'] as const) {
          const started = performance.now();
          const result = await generateDirector({ audience, reason: issue.signal, scenarioId, clientId, transcript, objectives: trainee.objectives, history: [], foundry, signal: AbortSignal.timeout(20_000) }, fetch, effort);
          (row.generation as unknown[]).push({ effort, durationMs: Math.round(performance.now() - started), ...result });
        }
      });
      row.decision = review.decision;
      await review.work;
    }
  }
} catch (error) {
  // Provider errors can carry credentials/prompts; keep console output generic.
  report.rows.push({ failure: error instanceof Error ? error.name : 'Unavailable' });
  process.exitCode = 1;
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output, windows: report.rows.filter(row => 'eligible' in row).length, eligible: report.rows.filter(row => row.eligible).length, completed: !process.exitCode }));
}
