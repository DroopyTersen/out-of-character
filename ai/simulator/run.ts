import { writeFile } from 'node:fs/promises';
import { evaluateClient, evaluateTrainee } from './evaluate.server';
import { simulatorFixtures, simulatorHoldouts, simulatorValidation } from './fixtures';
import { simulatorChallenges } from './challenge-fixtures';
import { RUBRIC_VERSION } from './rubric';
import { SIMULATOR_VERSION } from '../../core/simulator/types';
import { getScenario } from './scenarios.server';

// Explicit opt-in paid command; opening the workshop never runs this script.
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('Load TYPESAFE_API_KEY with bun --env-file=.dev.vars.');
const only = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
const replay = process.argv.includes('--replay');
const holdout = process.argv.includes('--holdout');
const validation = process.argv.includes('--validation');
const challenge = process.argv.includes('--challenge');
const outputArg = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (process.argv.includes('--output=')) throw new Error('Provide a path after --output=.');
const selected = only ? [...simulatorFixtures, ...simulatorHoldouts, ...simulatorValidation, ...simulatorChallenges].filter(item => item.id === only) : challenge ? simulatorChallenges : validation ? simulatorValidation : holdout ? simulatorHoldouts : replay ? simulatorFixtures.filter(item => ['earned-discovery', 'scope-tradeoff'].includes(item.id)) : simulatorFixtures;
if (!selected.length) throw new Error('Unknown fixture.');
const rows = [];
fixtures: for (const fixture of selected) {
  const lengths = replay ? (fixture.id === 'earned-discovery' ? [3, 5, 9, 13] : [3, 5, 7]) : [fixture.transcript.length];
  let achievedIds: string[] = [];
  for (const transcriptLength of lengths) {
  try {
    const input = { ...fixture, transcript: fixture.transcript.slice(0, transcriptLength), achievedIds, apiKey: key, revision: transcriptLength, signal: AbortSignal.timeout(30_000) };
    const trainee = await evaluateTrainee(input);
    const client = await evaluateClient({ ...input, signal: AbortSignal.timeout(30_000) });
    const achieved = trainee.objectives.filter(item => item.achieved).map(item => item.id);
    const checks = transcriptLength !== fixture.transcript.length ? [] : [
      ...fixture.expected.achieved.map(id => ({ name: `achieved:${id}`, passed: achieved.includes(id) })),
      ...fixture.expected.absent.map(id => ({ name: `absent:${id}`, passed: !achieved.includes(id) })),
      ...(fixture.expected.unavailable ?? []).map(id => ({ name: `unavailable:${id}`, passed: trainee.skills[id].value == null })),
      ...(fixture.expected.lowSkills ?? []).map(id => ({ name: `low:${id}`, passed: trainee.skills[id].value != null && trainee.skills[id].value! < 2 })),
      ...(fixture.expected.highSkills ?? []).map(id => ({ name: `high:${id}`, passed: trainee.skills[id].value != null && trainee.skills[id].value! >= 2.5 })),
      ...(fixture.expected.concern == null ? [] : [{ name: `concern:${fixture.expected.concern}`, passed: !!trainee.concern === fixture.expected.concern }]),
      ...Object.entries(fixture.expected.objectiveEvidence ?? {}).map(([id, entryId]) => ({ name: `evidence:${id}:${entryId}`, passed: trainee.objectives.find(item => item.id === id)?.evidence?.entryId === entryId })),
      ...(fixture.expected.cue ? [{ name: `cue:${fixture.expected.cue}`, passed: client.cueId === fixture.expected.cue }] : []),
    ];
    const scenario = getScenario(fixture.scenarioId);
    achievedIds = [...new Set([...achievedIds, ...achieved.filter(id => scenario.objectives.find(item => item.id === id)?.kind !== 'outcome')])];
    rows.push({ fixtureId: fixture.id, transcriptLength, trainee, client, checks });
    console.log(`${fixture.id} @${transcriptLength}: ${checks.filter(item => item.passed).length}/${checks.length} checks; trainee ${trainee.durationMs}ms, client ${client.durationMs}ms`);
  } catch (error) {
    // SDK errors can contain request headers and provider payloads. Never print them.
    console.error(`${fixture.id}: evaluation failed (${error instanceof Error ? error.name : 'unavailable'}).`);
    process.exitCode = 1;
    break fixtures;
  }
  }
}
const output = outputArg ?? (only ? `output/simulator-${only}.json` : challenge ? 'output/simulator-challenges.json' : validation ? 'ai/simulator/validation-results.json' : holdout ? 'ai/simulator/holdout-results.json' : replay ? 'ai/simulator/replay.json' : 'ai/simulator/results.json');
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: new Date().toISOString(), simulatorVersion: SIMULATOR_VERSION, rubricVersion: RUBRIC_VERSION, rows }, null, 2) + '\n');
if (rows.some(row => row.checks.some(check => !check.passed))) process.exitCode = 1;
console.log(`Saved ${rows.length} measured fixture results to ${output}.`);
