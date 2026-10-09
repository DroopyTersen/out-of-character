import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { experimental_evaluate as evaluate } from 'ai';
import { judgeModel } from '../../interview-engine/providers/jevJudge.server';
import { hash, interpret, type EvalCase } from './cases';
import { decisionsModel, DecisionFailure, singletons, type Fetch, type Format } from '../../interview-engine/providers/decisionJudge.server';

const directory = '.data/openai-decisions-evals';
const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const arms = option('arms', 'jev,literal').split(',');
const split = option('split', 'development');
const lanes = option('lanes', 'silence,turn,grade').split(',');
const repeats = Number(option('repeat', '1'));
const runId = option('out', new Date().toISOString().replaceAll(':', '-'));
if (arms.some(value => !['jev', 'literal', 'readable', 'dialogue'].includes(value)) || new Set(arms).size !== arms.length) throw new Error('Unknown or duplicate arm');
if (!['development', 'validation', 'all'].includes(split) || lanes.some(value => !['silence', 'turn', 'grade'].includes(value))) throw new Error('Unknown split or lane');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !/^[\w.-]+$/.test(runId)) throw new Error('Invalid repeat or output ID');
const corpus = await Bun.file(`${directory}/cases-v1.json`).json() as { hash: string; cases: EvalCase[] };
if (hash(corpus.cases) !== corpus.hash) throw new Error('Frozen corpus hash changed');
const cases = corpus.cases.filter(item => (split === 'all' || item.split === split) && lanes.includes(item.lane));
if (!cases.length) throw new Error('Empty case selection');
const plan = Array.from({ length: repeats }, (_, repeat) => cases.flatMap(item => {
  const offset = parseInt(hash([item.id, repeat]).slice(0, 4), 16) % arms.length;
  return [...arms.slice(offset), ...arms.slice(0, offset)].map(arm => ({ item, arm, repeat }));
})).flat();
console.log(JSON.stringify({ runId, corpusHash: corpus.hash, cases: cases.length, attempts: plan.length, arms, split, lanes }));
if (!process.argv.includes('--paid')) process.exit(0);
if (arms.includes('jev') && !process.env.TYPESAFE_API_KEY || arms.some(arm => arm !== 'jev') && !process.env.OPENAI_API_KEY) throw new Error('Missing provider credential');

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
await writeFile(`${path}/manifest.json`, JSON.stringify({ runId, corpusHash: corpus.hash, arms, split, lanes, repeats, createdAt: new Date().toISOString(),
  ratesUsdPerMillionInput: { jev: .042, decisions: .1 }, maxUsd: 5, maxAttempts: 468, sdkRetries: 0,
  sourceHashes: Object.fromEntries(await Promise.all(['interview-engine/providers/decisionJudge.server.ts', 'ai/decisions/cases.ts', 'ai/decisions/run.ts'].map(async file => [file, hash(await Bun.file(file).text())]))),
  plan: plan.map(({ item, arm, repeat }) => ({ caseId: item.id, inputHash: hash({ state: item.state, questions: item.questions }), arm, repeat })) }, null, 2), { mode: 0o600 });
const save = (file: string, value: unknown) => appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });

for (const [index, { item, arm, repeat }] of plan.entries()) {
  const id = `${runId}:${index}`;
  const rate = arm === 'jev' ? .042 : .1;
  // UTF-8 bytes plus ample envelope overhead conservatively bound input tokens for these requests.
  const reserved = (Buffer.byteLength(JSON.stringify({ state: item.state, questions: item.questions })) + 20000) * rate / 1e6;
  if (attempts >= 468 || spent + reserved > 5) throw new Error('Cumulative paid attempt or USD ceiling reached');
  await save(ledgerPath, { event: 'reserved', id, usd: reserved });
  spent += reserved; attempts++;
  const wire: { payloadHash: string; status?: number; requestId?: string | null; response?: unknown }[] = [];
  const auditedFetch: Fetch = async (url, init) => {
    const record: typeof wire[number] = { payloadHash: hash(typeof init?.body === 'string' ? JSON.parse(init.body) : null) };
    wire.push(record);
    const response = await fetch(url, init);
    record.status = response.status;
    record.requestId = response.headers.get('x-request-id');
    if (response.ok) record.response = await response.clone().json().catch(() => null);
    return response;
  };
  const model = arm === 'jev' ? singletons(judgeModel({ apiKey: process.env.TYPESAFE_API_KEY!, fetch: auditedFetch as typeof fetch }))
    : decisionsModel({ apiKey: process.env.OPENAI_API_KEY!, format: arm as Format, fetch: auditedFetch });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const signal = AbortSignal.timeout(item.deadlineMs);
  let result: Record<string, unknown>;
  try {
    const response = await evaluate({ model, state: item.state, questions: item.questions, abortSignal: signal, maxRetries: 0 });
    const durationMs = performance.now() - start;
    const output = interpret(item, response.answers);
    const inputTokens = response.usage.inputTokens;
    const outputTokens = response.usage.outputTokens;
    const usd = inputTokens == null ? null : inputTokens * rate / 1e6;
    if (usd != null) { await save(ledgerPath, { event: 'settled', id, usd }); spent += usd - reserved; }
    result = { status: 'ok', durationMs, answers: response.answers, output, usage: { inputTokens, outputTokens }, estimatedUsd: usd,
      resolvedModel: response.response.modelId, requestId: response.response.id };
  } catch (error) {
    result = { status: signal.aborted ? 'timeout' : error instanceof DecisionFailure ? error.category : 'error', durationMs: performance.now() - start,
      errorType: error instanceof Error ? error.name : 'unknown', httpStatus: error instanceof DecisionFailure ? error.status : undefined, estimatedUsd: null };
  }
  await save(`${path}/wire.jsonl`, { id, caseId: item.id, arm, wire });
  await save(`${path}/results.jsonl`, { id, caseId: item.id, lane: item.lane, split: item.split, source: item.source, arm, repeat, startedAt,
    deadlineMs: item.deadlineMs, inputHash: hash({ state: item.state, questions: item.questions }), ...result });
  console.log(`${index + 1}/${plan.length} ${arm} ${item.id} ${result.status} ${Math.round(Number(result.durationMs))}ms`);
}
console.log(`Saved ${plan.length} attempts to ${path}; cumulative reserved/settled estimate $${spent.toFixed(4)}.`);
