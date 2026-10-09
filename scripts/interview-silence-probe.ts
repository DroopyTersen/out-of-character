// Paid semantic replay only: no voice session, audio, database writes or deployments.
import { evaluateSilence, SILENCE_VERSION } from '../interview-engine/interview/session/silence.server';
import { createJevJudge } from '../interview-engine/providers/judge.server';
import type { WireEntry } from '../interview-engine/interview/wire';

const [input, output, paid] = Bun.argv.slice(2);
if (!input || !output || paid !== '--paid') throw new Error('Usage: bun --env-file=.dev.vars scripts/interview-silence-probe.ts <cases.json> <report.json> --paid');
if (!process.env.TYPESAFE_API_KEY) throw new Error('Load TYPESAFE_API_KEY with --env-file=.dev.vars.');
const cases = await Bun.file(input).json() as { id: string; transcript: WireEntry[]; expected: boolean }[];
const judge = createJevJudge({ apiKey: process.env.TYPESAFE_API_KEY });
const results = [];
for (const item of cases) {
  const started = performance.now();
  const result = await evaluateSilence({ transcript: item.transcript.slice(-8), judge: judge.model, signal: AbortSignal.timeout(3000) });
  const actual = result.probability >= judge.thresholds.silenceContinue;
  results.push({ id: item.id, passageIds: item.transcript.slice(-8).map(entry => entry.id), expected: item.expected, actual,
    ...result, durationMs: Math.round(performance.now() - started), pass: actual === item.expected });
  console.log(`${actual === item.expected ? 'PASS' : 'FAIL'} ${item.id}: ${result.probability.toFixed(3)} (${actual ? 'continue' : 'wait'})`);
}
await Bun.write(output, JSON.stringify({ version: SILENCE_VERSION, threshold: judge.thresholds.silenceContinue, results }, null, 2));
if (results.some(item => !item.pass)) process.exitCode = 1;
