import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluateClient, evaluateTrainee } from './evaluate.server';
import { generateDirector } from './director.server';
import { foundryConfig } from '../foundry.server';
import { simulatorFixtures, simulatorHoldouts, simulatorValidation } from './fixtures';
import { simulatorChallenges } from './challenge-fixtures';
import { simulatorBlindFixtures } from './blind-fixtures';
import { simulatorCatalogFixtures } from './catalog-fixtures';
import { DirectorGate, DIRECTOR_VERSION, type DirectorAudience, type DirectorSignal } from '../../core/simulator/director';
import { JEV_MODEL } from '../judging';

// This opt-in development replay uses synthetic simulator fixtures. It is not a live
// latency/actor-compliance test or a substitute for the held-out release gates.
// Interviews have no director; scripts/sol-map-probe.ts and scripts/ranking-probe.ts replay the interview producer.
if (!process.argv.includes('--paid')) throw new Error('Pass --paid and --fixture=<id> to run a bounded provider replay.');
const id = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
const fixture = [...simulatorFixtures, ...simulatorHoldouts, ...simulatorValidation, ...simulatorChallenges, ...simulatorBlindFixtures, ...simulatorCatalogFixtures].find(item => item.id === id);
if (!fixture) throw new Error('Select a known synthetic fixture with --fixture=<id>.');
const foundry = foundryConfig(process.env);
if (!process.env.TYPESAFE_API_KEY) throw new Error('Load the existing server credentials with --env-file=.dev.vars.');
const compare = process.argv.includes('--compare');
const turns = process.argv.includes('--every-turn') ? fixture.transcript.map((_, index) => index + 1).filter(length => fixture.transcript.slice(0, length).some(entry => entry.speaker === 'trainee')) : [fixture.transcript.length];
if (turns.length > 24) throw new Error('Replay is limited to 24 snapshots; choose a shorter fixture.');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || `output/director-replay-${fixture.id}.json`;
const report = { synthetic: true, fixture: fixture.id, kind: 'simulator', collectedAt: new Date().toISOString(), version: DIRECTOR_VERSION, models: { detector: JEV_MODEL, director: foundry.agentModel }, compare, rows: [] as Record<string, unknown>[] };
const gate = new DirectorGate();

try {
  for (const turn of turns) {
    const transcript = fixture.transcript.slice(0, turn);
    const scenarioId = fixture.scenarioId;
    const clientId = fixture.clientId;
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
