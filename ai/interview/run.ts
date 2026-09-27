import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { INTERVIEW_SCENARIO_ID } from '../../core/interview';
import { evaluateInterview, evaluateInterviewer } from './evaluate.server';
import { interviewFixtures } from './fixtures';
import { INTERVIEW_RUBRIC_VERSION } from './rubric';

// Explicit opt-in paid replay. All fixtures are synthetic; this is never called by the app.
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error('Load TYPESAFE_API_KEY with bun --env-file=.dev.vars.');
const only = process.argv.find(arg => arg.startsWith('--fixture='))?.slice('--fixture='.length);
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length) ?? 'output/interview/results.json';
if (!output) throw new Error('Provide a path after --output=.');
const fixtures = only ? interviewFixtures.filter(item => item.id === only) : interviewFixtures;
if (!fixtures.length) throw new Error('Unknown interview fixture.');

const rows = [];
for (const fixture of fixtures) {
  try {
    const input = { scenarioId: INTERVIEW_SCENARIO_ID, clientId: 'sam-cedar', transcript: fixture.transcript,
      revision: fixture.transcript.length, apiKey, signal: AbortSignal.timeout(30_000) };
    const participant = await evaluateInterview(input);
    const interviewer = await evaluateInterviewer({ ...input, signal: AbortSignal.timeout(30_000) });
    const heard = participant.objectives.filter(item => item.achieved).map(item => item.id);
    const checks = [
      ...fixture.expected.heard.map(id => ({ name: `heard:${id}`, passed: heard.includes(id) })),
      ...fixture.expected.unheard.map(id => ({ name: `unheard:${id}`, passed: !heard.includes(id) })),
      ...(fixture.expected.highReadings?.map(id => ({ name: `high:${id}`, passed: (participant.readings[id].value ?? -1) >= 2.5 })) ?? []),
      ...(fixture.expected.lowReadings?.map(id => ({ name: `low:${id}`, passed: (participant.readings[id].value ?? 5) < 2 })) ?? []),
      ...(fixture.expected.blankReadings?.map(id => ({ name: `blank:${id}`, passed: participant.readings[id].value == null })) ?? []),
      ...(fixture.expected.cue ? [{ name: `cue:${String(fixture.expected.cue)}`, passed: (Array.isArray(fixture.expected.cue) ? fixture.expected.cue : [fixture.expected.cue]).includes(interviewer.cueId) }] : []),
      ...participant.objectives.filter(item => item.achieved).map(item => ({ name: `source:${item.id}`, passed: item.evidence?.speaker === 'trainee' && fixture.transcript.some(entry => entry.id === item.evidence?.entryId && entry.text === item.evidence.text) })),
    ];
    rows.push({ fixtureId: fixture.id, participant, interviewer, checks });
    console.log(`${fixture.id}: ${checks.filter(item => item.passed).length}/${checks.length} checks; participant ${participant.durationMs}ms, interviewer ${interviewer.durationMs}ms`);
  } catch (error) {
    // Provider errors may contain request metadata. Keep them out of the terminal.
    console.error(`${fixture.id}: evaluation failed (${error instanceof Error ? error.name : 'unavailable'}).`);
    process.exitCode = 1;
    break;
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: new Date().toISOString(), rubricVersion: INTERVIEW_RUBRIC_VERSION, rows }, null, 2) + '\n');
if (rows.some(row => row.checks.some(check => !check.passed))) process.exitCode = 1;
console.log(`Saved ${rows.length} measured synthetic fixture results to ${output}.`);
