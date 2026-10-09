// Bounded real-voice checks. Review the generated first turns against each case's expectations.
// bun --env-file=.dev.vars scripts/interview-opening-probe.mjs --paid
import { resolveInterview } from '../interview-engine/interview/definition.server.ts';
import { interviewerBrief, interviewOpening } from '../interview-engine/interview/voice/brief.server.ts';
import { spec as closeout } from '../interviews/project-closeout/spec.ts';
import { spec as winLoss } from '../interviews/sales-win-loss/spec.ts';
import { captureLiveClip } from './lib/live-voice-clip.mjs';

if (!Bun.argv.includes('--paid')) throw new Error('Pass --paid for three short synthetic voice openings.');
const cases = [
  { id: 'closeout-no-context', spec: closeout,
    expected: 'Introduce Sam and the learning purpose, then ask what the project delivered and who the client was. Do not treat Project closeout as a project name or start with the participant’s role.' },
  { id: 'closeout-known-context', spec: resolveInterview(closeout.plan, closeout.config, { background: 'The interview concerns Project Beacon, recently completed for the client Harbor Labs.', participant: { name: 'Jordan' } }),
    expected: 'Introduce Sam and the learning purpose, mention Project Beacon and Harbor Labs naturally, then ask what was built or delivered. Do not ask for the already supplied project/client names or invent outcomes.' },
  { id: 'win-loss-no-context', spec: winLoss,
    expected: 'Introduce Sam, explain learning from the purchase decision rather than making a sales call, and ask what was being bought and how the decision turned out. Do not assume a winner or use project-closeout framing.' },
];
const results = [];
const selected = Bun.argv.find(value => value.startsWith('--case='))?.slice('--case='.length);
if (selected && !cases.some(row => row.id === selected)) throw new Error('Unknown opening case.');
for (const row of cases.filter(row => !selected || row.id === selected)) {
  const voice = row.spec.interviewer.voices[0];
  try {
    const result = await captureLiveClip({ voice: voice.voice, instructions: interviewerBrief(row.spec, voice.id), opening: interviewOpening(row.spec, voice.id) });
    results.push({ id: row.id, expected: row.expected, transcript: result.transcript, audioBytes: result.pcm.length });
  } catch (error) {
    results.push({ id: row.id, expected: row.expected, error: error.message, transcript: error.partial?.transcript ?? '', eventCounts: error.partial?.eventCounts });
  }
  console.log(JSON.stringify(results.at(-1)));
  await Bun.write('output/interview-opening-probe/result.json', JSON.stringify({ checkedAt: new Date().toISOString(), synthetic: true, results }, null, 2) + '\n');
  if (results.at(-1).error) break;
}
if (results.some(result => result.error)) process.exitCode = 1;
