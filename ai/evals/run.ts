import { readFile, writeFile } from 'node:fs/promises';
import { evaluateCharacters, JEV_MODEL, JUDGING_VERSION, type JudgingMode } from '../judging';
import { CAST_VERSION, characters } from '../../core/characters';
import { fixtures, brownfieldRegression, type TranscriptFixture } from './fixtures';

async function apiKey() {
  if (process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_AI_API_KEY) return process.env.TYPESAFE_API_KEY ?? process.env.TYPESAFE_AI_API_KEY!;
  for (const path of ['.dev.vars', '.env']) {
    try {
      const text = await readFile(path, 'utf8');
      const match = text.match(/^(?:export\s+)?TYPESAFE(?:_AI)?_API_KEY\s*=\s*["']?([^\r\n"']+)/m);
      if (match) return match[1]!.trim();
    } catch { /* Known optional credentials file does not exist. */ }
  }
  throw new Error('No TypeSafe key found in the environment or project credentials files.');
}

const modeFlag = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1];
if (modeFlag && !['noul', 'score', 'both'].includes(modeFlag)) throw new Error('Mode must be noul, score, or both.');
const modes: JudgingMode[] = modeFlag === 'noul' ? ['noul'] : modeFlag === 'score' ? ['score'] : ['noul', 'score'];
const smoke = process.argv.includes('--smoke');
const selected = process.argv.includes('--regression') ? brownfieldRegression : smoke ? fixtures.filter((fixture) => ['architecture', 'neutral', 'name-only', 'injection'].includes(fixture.id)) : fixtures;
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) ?? 'ai/evals/comparison.json';
const key = await apiKey();
const rows: (TranscriptFixture & Awaited<ReturnType<typeof evaluateCharacters>> & {
  mode: JudgingMode;
  judgingVersion: string;
  target: number | undefined;
  passed: boolean;
})[] = [];
console.log(`Evaluating ${selected.length} fixed synthetic transcripts × ${modes.length} modes = ${selected.length * modes.length} requests, all ${characters.length} characters per request.`);
for (const fixture of selected) {
  for (const mode of modes) {
    try {
      const result = await evaluateCharacters({ transcript: fixture.transcript, apiKey: key, mode, signal: AbortSignal.timeout(20000) });
      const leaders = Object.entries(result.readings).sort((a, b) => b[1] - a[1]);
      const target = fixture.expected ? result.readings[fixture.expected] : undefined;
      rows.push({ ...fixture, mode, judgingVersion: JUDGING_VERSION, ...result, target, passed: fixture.expected ? target! >= .8 : leaders[0]![1] < .8 });
      console.log(`${fixture.id} ${mode}: ${result.durationMs}ms target=${target ?? 'negative'} max=${leaders[0]![0]}:${leaders[0]![1]} input=${result.usage.inputTokens}`);
    } catch (error) {
      // Provider errors may contain request headers or response bodies; never serialize them.
      const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 'unavailable';
      console.error(`${fixture.id} ${mode}: failed (${error instanceof Error ? error.name : 'unknown error'}, status=${status})`);
      throw new Error('Live evaluation failed; inspect sanitized provider status before resuming.');
    }
  }
}
const inputTokens = rows.reduce((sum, row) => sum + (row.usage.inputTokens ?? 0), 0);
const summary = modes.map((mode) => {
  const subset = rows.filter((row) => row.mode === mode);
  const latencies = subset.map((row) => row.durationMs).sort((a, b) => a - b);
  return { mode, passed: subset.filter((row) => row.passed).length, total: subset.length, medianMs: latencies[Math.floor(latencies.length / 2)], p95Ms: latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * .95) - 1)] };
});
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: new Date().toISOString(), castVersion: CAST_VERSION, judgingVersion: JUDGING_VERSION, requestedModel: JEV_MODEL, inputTokens, estimatedCostUsd: inputTokens * .042 / 1_000_000, summary, rows }, null, 2) + '\n');
console.log(JSON.stringify({ output, inputTokens, estimatedCostUsd: inputTokens * .042 / 1_000_000, summary }));
