import { mkdir, writeFile } from 'node:fs/promises';
import { foundryConfig } from '../ai/foundry.server.ts';
import { generateScene } from '../ai/scenes.ts';
import { characters } from '../core/characters.ts';
import { generateDirector } from '../ai/simulator/director.server.ts';
import { generateProducer } from '../ai/interview/producer.server.ts';
import { lookupInterviewBackground } from '../ai/interview/research.server.ts';
import { summarizeInterview } from '../ai/interview/summary.server.ts';
import { generateReport } from '../ai/simulator/report.server.ts';
import { evaluateInterview } from '../ai/interview/evaluate.server.ts';
import { captureLiveClip } from './lib/live-voice-clip.mjs';

// A bounded synthetic check of each paid integration. Never prints credentials or prompts.
// bun --env-file=.dev.vars scripts/foundry-smoke.mjs --paid
if (!process.argv.includes('--paid')) throw new Error('Pass --paid to verify the configured providers.');
const foundry = foundryConfig(process.env);
if (!process.env.TYPESAFE_API_KEY) throw new Error('TypeSafe is not configured.');
const output = process.env.ACCEPTANCE_OUTPUT || 'output/foundry-smoke';
await mkdir(output, { recursive: true, mode: 0o700 });
const transcript = [
  { id: 'p1', speaker: 'client', text: 'What did you deliver, and how did it help?', startMs: 0, endMs: 2000 },
  { id: 'p2', speaker: 'trainee', text: 'We built a routing portal with OpenStreetMap. I led the API work. Testing a sample payload with the vendor before coding caught a date format mismatch.', startMs: 2100, endMs: 11000 },
  { id: 'p3', speaker: 'client', text: 'What changed after that discovery?', startMs: 12000, endMs: 14000 },
  { id: 'p4', speaker: 'trainee', text: 'We agreed the format first and avoided rework. Next time I would include sample payload testing in the estimate.', startMs: 15000, endMs: 21000 },
];
const signal = () => AbortSignal.timeout(90_000);
const consume = async generate => {
  let result, text = '', chunks = 0;
  for await (const chunk of generate(value => { result = value; })) { text += chunk; chunks++; }
  if (!result?.report || result.failure) throw new Error(`Stream failed: ${result?.failure ?? 'unfinished'}`);
  JSON.parse(text);
  return { chunks, characters: text.length, usage: result.usage };
};
const checks = {
  scene: async () => ({ text: await generateScene({ characterId: characters[0].id, history: [], foundry, signal: signal() }) }),
  director: async () => generateDirector({ audience: 'trainee', reason: { condition: 'objective:decision', selected: true },
    scenarioId: 'proposal', clientId: 'morgan', transcript, objectives: [], history: [], foundry, signal: signal() }),
  producer: async () => generateProducer({ clientId: 'sam-cedar', transcript, coverage: [], history: [],
    startedAt: Date.now() - 120_000, now: Date.now(), triggers: [{ kind: 'check-in' }],
    budget: { cuesLeft: 15, researchLeft: 4, lookupsInFlight: 0 }, foundry, signal: signal() }),
  research: async () => {
    const result = await lookupInterviewBackground({ target: { kind: 'product', name: 'OpenStreetMap' }, clue: null, foundry, signal: signal() });
    if (result.status !== 'found') throw new Error(`Public research unresolved: ${result.reason}`);
    return result;
  },
  summary: () => consume(finish => summarizeInterview({ transcript, foundry, signal: signal() }, finish)),
  report: () => consume(finish => generateReport({ foundry, signal: signal(), interventions: [], snapshot: {
    id: 'synthetic-foundry-smoke', scenarioId: 'proposal', clientId: 'morgan', status: 'ended', startedAt: Date.now() - 120_000,
    limitSeconds: 3600, warning: null, revision: 1, transcript, evaluation: null, coaching: null,
    feedbackStatus: 'waiting', message: null, finalization: 'confirmed', usageSeconds: 21,
  } }, finish)),
  jev: async () => {
    const result = await evaluateInterview({ scenarioId: 'project-closeout', clientId: 'sam-cedar', transcript, revision: 1,
      apiKey: process.env.TYPESAFE_API_KEY, signal: signal() });
    if (!result.model.includes('jev')) throw new Error('Expected Jev evaluation.');
    return { model: result.model, durationMs: result.durationMs };
  },
  live: async () => {
    const result = await captureLiveClip({ voice: 'cedar',
      instructions: 'Speak one short sentence in English, then listen. No external tasks.',
      opening: 'Say: The Foundry voice connection is working.', timeoutMs: 35_000 });
    return { model: foundry.liveModel, audioBytes: result.pcm.length, transcript: result.transcript };
  },
};
const report = { at: new Date().toISOString(), resource: foundry.resourceName, models: {
  agent: foundry.agentModel, fast: foundry.fastModel, live: foundry.liveModel,
}, synthetic: true, checks: [] };
for (const [name, check] of Object.entries(checks)) {
  const start = performance.now();
  try {
    const result = await check();
    report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start), result });
  }
  catch (error) { report.checks.push({ name, passed: false, error: error.message }); }
  console.log(JSON.stringify(report.checks.at(-1)));
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
if (report.checks.some(check => !check.passed)) process.exitCode = 1;
