import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { APICallError, experimental_evaluate as evaluate } from 'ai';
import { judgeModel } from '../../interview-engine/providers/jevJudge.server';
import { hash, interpret, type EvalCase } from './cases';
import { decisionsModel, DecisionFailure, singletons, type Fetch, type Format } from '../../interview-engine/providers/decisionJudge.server';
import { anchoredRequest, foundryModel, foundryRequest, type FoundryFormat } from './foundry';

const directory = '.data/openai-decisions-evals';
const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const arms = option('arms', 'jev,literal').split(',');
const split = option('split', 'development');
const lanes = option('lanes', 'silence,turn,grade').split(',');
const repeats = Number(option('repeat', '1'));
const runId = option('out', new Date().toISOString().replaceAll(':', '-'));
const maxAttempts = Number(option('max-attempts', '468'));
const completedRun = option('completed-run', '');
const anchorRun = option('anchor-run', '');
if (arms.some(value => !['jev', 'literal', 'readable', 'dialogue', 'foundry', 'foundry-readable', 'foundry-dialogue', 'foundry-task-last', 'foundry-evidence', 'foundry-evidence-compact', 'foundry-context', 'foundry-scoped', 'foundry-clarified', 'foundry-precise', 'foundry-topic', 'foundry-satisfied', 'foundry-satisfied-short', 'foundry-accounts', 'foundry-anchored', 'foundry-human', 'foundry-synthetic-1', 'foundry-synthetic-2', 'foundry-synthetic-3', 'foundry-synthetic-4', 'jev-optimized', 'literal-optimized'].includes(value)) || new Set(arms).size !== arms.length) throw new Error('Unknown or duplicate arm');
if (!['development', 'validation', 'all'].includes(split) || lanes.some(value => !['silence', 'turn', 'grade'].includes(value))) throw new Error('Unknown split or lane');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !/^[\w.-]+$/.test(runId)) throw new Error('Invalid repeat or output ID');
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid paid attempt ceiling');
if (completedRun && !/^[\w.-]+$/.test(completedRun)) throw new Error('Invalid completed run ID');
const corpus = await Bun.file(`${directory}/cases-v1.json`).json() as { hash: string; cases: EvalCase[] };
if (hash(corpus.cases) !== corpus.hash) throw new Error('Frozen corpus hash changed');
const cases = corpus.cases.filter(item => (split === 'all' || item.split === split) && lanes.includes(item.lane));
if (!cases.length) throw new Error('Empty case selection');
const optimizedFormats = { silence: 'literal', turn: 'precise', grade: 'human' } as const;
let optimized: Record<string, unknown> | undefined;
if (arms.some(arm => arm.endsWith('-optimized'))) {
  const turnFreeze = await Bun.file(`${directory}/microsoft-turn-goal-freeze.json`).json();
  const gradeFreeze = await Bun.file(`${directory}/microsoft-grade-goal-final-freeze.json`).json();
  if (turnFreeze.arm !== 'foundry-precise' || gradeFreeze.arm !== 'foundry-human' || [turnFreeze, gradeFreeze].some(frozen => frozen.corpusHash !== corpus.hash)) throw new Error('Optimized recipe differs from the frozen Microsoft candidate');
  optimized = { formats: optimizedFormats, gates: gradeFreeze.gates, turnFreezeHash: hash(turnFreeze), gradeFreezeHash: hash(gradeFreeze),
    requestHashes: Object.fromEntries(cases.map(item => [item.id, hash(foundryRequest({ state: item.state, questions: item.questions }, optimizedFormats[item.lane]))])) };
}
const anchors = new Map<string, { id: string; answers: Parameters<typeof anchoredRequest>[1]; durationMs: number; estimatedUsd: number; inputHash: string }>();
let anchorHash: string | undefined;
if (arms.includes('foundry-anchored')) {
  if (!/^[\w.-]+$/.test(anchorRun) || lanes.some(lane => lane !== 'grade')) throw new Error('Anchored grading requires a first-pass run and grade-only cases');
  const manifest = await Bun.file(`${directory}/runs/${anchorRun}/manifest.json`).json();
  const entries = (await Bun.file(`${directory}/runs/${anchorRun}/results.jsonl`).text()).trim().split('\n').map(line => JSON.parse(line));
  if (manifest.corpusHash !== corpus.hash || entries.length !== manifest.plan.length) throw new Error('Invalid first-pass run');
  for (const row of entries) {
    const item = corpus.cases.find(item => item.id === row.caseId);
    if (!item || row.status !== 'ok' || row.lane !== 'grade' || row.inputHash !== hash({ state: item.state, questions: item.questions })) throw new Error('Invalid first-pass evidence');
    const key = `${row.caseId}/${row.repeat}`;
    if (anchors.has(key)) throw new Error('Duplicate first-pass slot');
    anchors.set(key, row);
  }
  anchorHash = hash(entries);
}
let plan = Array.from({ length: repeats }, (_, repeat) => cases.flatMap(item => {
  const offset = parseInt(hash([item.id, repeat]).slice(0, 4), 16) % arms.length;
  return [...arms.slice(offset), ...arms.slice(0, offset)].map(arm => ({ item, arm, repeat }));
})).flat();
if (completedRun) {
  const previousManifest = await Bun.file(`${directory}/runs/${completedRun}/manifest.json`).json();
  const entries = (await Bun.file(`${directory}/runs/${completedRun}/results.jsonl`).text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (previousManifest.corpusHash !== corpus.hash || entries.length !== previousManifest.plan.length) throw new Error('Completed run is incomplete or uses another corpus');
  for (const [index, row] of entries.entries()) {
    const planned = previousManifest.plan[index];
    const item = corpus.cases.find(item => item.id === row.caseId);
    if (!item || row.status !== 'ok' || row.caseId !== planned.caseId || row.arm !== planned.arm || row.repeat !== planned.repeat
      || row.inputHash !== planned.inputHash || row.inputHash !== hash({ state: item.state, questions: item.questions })) throw new Error('Invalid completed run result');
  }
  const completed = new Set(entries.map(row => `${row.caseId}/${row.arm}/${row.repeat}`));
  if (completed.size !== entries.length) throw new Error('Duplicate completed attempt');
  plan = plan.filter(({ item, arm, repeat }) => !completed.has(`${item.id}/${arm}/${repeat}`));
}
if (!plan.length) throw new Error('No remaining attempts');
console.log(JSON.stringify({ runId, corpusHash: corpus.hash, cases: cases.length, attempts: plan.length, arms, split, lanes }));
if (!process.argv.includes('--paid')) process.exit(0);
if (arms.some(arm => arm.startsWith('jev')) && !process.env.TYPESAFE_API_KEY
  || arms.some(arm => ['literal', 'readable', 'dialogue', 'literal-optimized'].includes(arm)) && !process.env.OPENAI_API_KEY
  || arms.some(arm => arm.startsWith('foundry')) && (!process.env.FOUNDRY_API_KEY || !process.env.FOUNDRY_BASE_URL || !process.env.FOUNDRY_MODEL)) throw new Error('Missing provider credential or endpoint');

// One cumulative reservation ledger across all immutable run directories, including failures.
const ledgerPath = `${directory}/budget.jsonl`;
const ledger = await readFile(ledgerPath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
const previous = ledger.trim() ? ledger.trim().split('\n').map(line => JSON.parse(line)) : [];
const reservations = new Map<string, number>();
for (const row of previous) reservations.set(row.id, row.usd);
let spent = [...reservations.values()].reduce((sum, value) => sum + value, 0);
let attempts = previous.filter(row => row.event === 'reserved').length;
const path = `${directory}/runs/${runId}`;
await mkdir(path, { mode: 0o700 }); // Fails rather than overwriting an existing run.
await writeFile(`${path}/manifest.json`, JSON.stringify({ runId, corpusHash: corpus.hash, arms, split, lanes, repeats, completedRun: completedRun || undefined, createdAt: new Date().toISOString(),
  ratesUsdPerMillionInput: { jev: .042, decisions: .1, foundry: .042 }, maxUsd: 5, maxAttempts, sdkRetries: 0,
  ...(arms.some(arm => arm.startsWith('foundry')) ? { foundry: { baseURL: process.env.FOUNDRY_BASE_URL, model: process.env.FOUNDRY_MODEL } } : {}),
  ...(anchorRun ? { firstPass: { runId: anchorRun, resultsHash: anchorHash } } : {}),
  ...(optimized ? { optimized } : {}),
  goldHashes: Object.fromEntries(await Promise.all(['turn', 'grade'].map(async lane => [lane, hash(await Bun.file(`${directory}/${lane}-gold.json`).json())]))),
  sourceHashes: Object.fromEntries(await Promise.all(['interview-engine/providers/decisionJudge.server.ts', 'interview-engine/providers/jevJudge.server.ts', 'ai/decisions/foundry.ts', 'ai/decisions/cases.ts', 'ai/decisions/run.ts'].map(async file => [file, hash(await Bun.file(file).text())]))),
  plan: plan.map(({ item, arm, repeat }) => ({ caseId: item.id, inputHash: hash({ state: item.state, questions: item.questions }), arm, repeat })) }, null, 2), { mode: 0o600 });
const save = (file: string, value: unknown) => appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });

for (const [index, { item, arm, repeat }] of plan.entries()) {
  const id = `${runId}:${index}`;
  const rate = arm.startsWith('jev') || arm.startsWith('foundry') ? .042 : .1;
  const format = (arm === 'foundry' ? 'literal' : arm.slice('foundry-'.length)) as FoundryFormat;
  const request = { state: item.state, questions: item.questions };
  const anchor = arm === 'foundry-anchored' ? anchors.get(`${item.id}/${repeat}`) : undefined;
  if (arm === 'foundry-anchored' && !anchor) throw new Error('Missing first-pass slot');
  const reservedRequest = anchor ? anchoredRequest(request, anchor.answers) : arm.endsWith('-optimized') ? foundryRequest(request, optimizedFormats[item.lane])
    : arm.startsWith('foundry') ? foundryRequest(request, format) : request;
  // UTF-8 bytes plus ample envelope overhead conservatively bound input tokens for these requests.
  const reserved = (Buffer.byteLength(JSON.stringify(reservedRequest)) + 20000) * rate / 1e6;
  if (attempts >= maxAttempts || spent + reserved > 5) throw new Error('Cumulative paid attempt or USD ceiling reached');
  await save(ledgerPath, { event: 'reserved', id, usd: reserved });
  spent += reserved; attempts++;
  const wire: { payloadHash: string; status?: number; requestId?: string | null; response?: unknown; error?: unknown }[] = [];
  const auditedFetch: Fetch = async (url, init) => {
    const record: typeof wire[number] = { payloadHash: hash(typeof init?.body === 'string' ? JSON.parse(init.body) : null) };
    wire.push(record);
    const response = await fetch(url, init);
    record.status = response.status;
    record.requestId = response.headers.get('x-request-id') ?? response.headers.get('apim-request-id');
    if (response.ok) record.response = await response.clone().json().catch(() => null);
    else record.error = await response.clone().json().catch(() => null);
    return response;
  };
  const model = arm.startsWith('jev') ? singletons(judgeModel({ apiKey: process.env.TYPESAFE_API_KEY!, fetch: auditedFetch as typeof fetch }))
    : arm.startsWith('foundry') ? foundryModel({ apiKey: process.env.FOUNDRY_API_KEY!, baseURL: process.env.FOUNDRY_BASE_URL!, model: process.env.FOUNDRY_MODEL!, fetch: auditedFetch })
    : decisionsModel({ apiKey: process.env.OPENAI_API_KEY!, format: arm === 'literal-optimized' ? 'literal' : arm as Format, fetch: auditedFetch });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const signal = AbortSignal.timeout(Math.max(1, item.deadlineMs - Math.ceil(anchor?.durationMs ?? 0)));
  let result: Record<string, unknown>;
  try {
    const response = await evaluate({ model, ...reservedRequest, abortSignal: signal, maxRetries: 0 });
    const durationMs = performance.now() - start;
    const output = interpret(item, response.answers);
    const inputTokens = response.usage.inputTokens;
    const outputTokens = response.usage.outputTokens;
    const usd = inputTokens == null ? null : inputTokens * rate / 1e6;
    if (usd != null) { await save(ledgerPath, { event: 'settled', id, usd }); spent += usd - reserved; }
    result = { status: 'ok', durationMs, answers: response.answers, output, usage: { inputTokens, outputTokens }, estimatedUsd: usd,
      resolvedModel: response.response.modelId, requestId: response.response.id };
  } catch (error) {
    result = { status: signal.aborted ? 'timeout' : error instanceof DecisionFailure ? error.category : APICallError.isInstance(error) ? 'http' : 'error', durationMs: performance.now() - start,
      errorType: error instanceof Error ? error.name : 'unknown', httpStatus: error instanceof DecisionFailure ? error.status : APICallError.isInstance(error) ? error.statusCode : undefined, estimatedUsd: null };
  }
  await save(`${path}/wire.jsonl`, { id, caseId: item.id, arm, wire });
  await save(`${path}/results.jsonl`, { id, caseId: item.id, lane: item.lane, split: item.split, source: item.source, arm, repeat, startedAt,
    deadlineMs: item.deadlineMs, inputHash: hash({ state: item.state, questions: item.questions }), ...result,
    ...(anchor ? { firstPassId: anchor.id, firstPassUsd: anchor.estimatedUsd, firstPassDurationMs: anchor.durationMs,
      pipelineUsd: typeof result.estimatedUsd === 'number' ? result.estimatedUsd + anchor.estimatedUsd : null,
      pipelineDurationMs: Number(result.durationMs) + anchor.durationMs } : {}) });
  console.log(`${index + 1}/${plan.length} ${arm} ${item.id} ${result.status} ${Math.round(Number(result.durationMs))}ms`);
}
console.log(`Saved ${plan.length} attempts to ${path}; cumulative reserved/settled estimate $${spent.toFixed(4)}.`);
