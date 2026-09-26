import { writeFile } from 'node:fs/promises';
import { evaluateClient, evaluateTrainee } from './evaluate.server';
import { simulatorFixtures } from './fixtures';
import { RUBRIC_VERSION } from './rubric';
import { SIMULATOR_VERSION } from '../../core/simulator/types';

// Explicit opt-in paid command; opening the workshop never runs this script.
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error('Load TYPESAFE_API_KEY with bun --env-file=.dev.vars.');
const only = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
const selected = only ? simulatorFixtures.filter(item => item.id === only) : simulatorFixtures;
if (!selected.length) throw new Error('Unknown fixture.');
const rows = [];
for (const fixture of selected) {
  try {
    const input = { ...fixture, apiKey: key, revision: fixture.transcript.length, signal: AbortSignal.timeout(30_000) };
    const trainee = await evaluateTrainee(input);
    const client = await evaluateClient({ ...input, signal: AbortSignal.timeout(30_000) });
    const achieved = trainee.objectives.filter(item => item.achieved).map(item => item.id);
    const checks = [
      ...fixture.expected.achieved.map(id => ({ name: `achieved:${id}`, passed: achieved.includes(id) })),
      ...fixture.expected.absent.map(id => ({ name: `absent:${id}`, passed: !achieved.includes(id) })),
      ...(fixture.expected.unavailable ?? []).map(id => ({ name: `unavailable:${id}`, passed: trainee.skills[id].value == null })),
      ...(fixture.expected.lowSkills ?? []).map(id => ({ name: `low:${id}`, passed: trainee.skills[id].value != null && trainee.skills[id].value! < 2 })),
      ...(fixture.expected.highSkills ?? []).map(id => ({ name: `high:${id}`, passed: trainee.skills[id].value != null && trainee.skills[id].value! >= 2.5 })),
      ...(fixture.expected.cue ? [{ name: `cue:${fixture.expected.cue}`, passed: client.cueId === fixture.expected.cue }] : []),
    ];
    rows.push({ fixtureId: fixture.id, trainee, client, checks });
    console.log(`${fixture.id}: ${checks.filter(item => item.passed).length}/${checks.length} checks; trainee ${trainee.durationMs}ms, client ${client.durationMs}ms`);
  } catch (error) {
    // SDK errors can contain request headers and provider payloads. Never print them.
    console.error(`${fixture.id}: evaluation failed (${error instanceof Error ? error.name : 'unavailable'}).`);
    process.exitCode = 1;
    break;
  }
}
const output = only ? `output/simulator-${only}.json` : 'ai/simulator/results.json';
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: new Date().toISOString(), simulatorVersion: SIMULATOR_VERSION, rubricVersion: RUBRIC_VERSION, rows }, null, 2) + '\n');
if (rows.some(row => row.checks.some(check => !check.passed))) process.exitCode = 1;
console.log(`Saved ${rows.length} measured fixture results to ${output}.`);
