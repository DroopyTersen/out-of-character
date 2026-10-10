import { calibrate, hash, scoreChecks, type Check, type EvalCase } from './cases';
import type { Result } from '../../interview-engine/providers/decisionJudge.server';
import { foundryRequest, type FoundryFormat } from './foundry';

type Row = { id: string; caseId: string; arm: string; lane: string; split: string; source: string; status: string; durationMs: number;
  startedAt: string; estimatedUsd: number | null; output?: Record<string, unknown>; answers?: Result['answers']; usage?: { inputTokens: number; outputTokens: number } };
type Gold = { caseId: string; checks: Check[]; notes?: string };
const directory = '.data/openai-decisions-evals';
const corpus = await Bun.file(`${directory}/cases-v1.json`).json() as { hash: string; cases: EvalCase[] };
if (hash(corpus.cases) !== corpus.hash) throw new Error('Frozen corpus changed');
const gold: Gold[] = [];
for (const lane of ['turn', 'grade']) {
  gold.push(...await Bun.file(`${directory}/${lane}-gold.json`).json());
}
if (new Set(gold.map(item => item.caseId)).size !== gold.length) throw new Error('Duplicate gold case');
if (gold.some(row => !corpus.cases.some(item => item.id === row.caseId))) throw new Error('Unknown gold case');
const cases = new Map(corpus.cases.map(item => [item.id, { ...item, checks: [...item.checks, ...gold.filter(row => row.caseId === item.id).flatMap(row => row.checks)] }]));
const runs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!runs.length || runs.some(run => !/^[\w.-]+$/.test(run))) throw new Error('Provide run directory IDs');
const rows: Row[] = [];
let optimizedRecipe: { gates: Parameters<typeof calibrate>[3]; formats: Record<string, FoundryFormat>; turnFreezeHash: string; gradeFreezeHash: string } | undefined;
for (const run of runs) {
  const manifest = await Bun.file(`${directory}/runs/${run}/manifest.json`).json();
  if (manifest.corpusHash !== corpus.hash) throw new Error('Run corpus mismatch');
  if (manifest.goldHashes) for (const lane of ['turn', 'grade']) {
    if (manifest.goldHashes[lane] !== hash(await Bun.file(`${directory}/${lane}-gold.json`).json())) throw new Error('Run gold mismatch');
  }
  if (manifest.optimized) {
    if (optimizedRecipe && hash(optimizedRecipe) !== hash({ gates: manifest.optimized.gates, formats: manifest.optimized.formats,
      turnFreezeHash: manifest.optimized.turnFreezeHash, gradeFreezeHash: manifest.optimized.gradeFreezeHash })) throw new Error('Optimized comparison recipe changed');
    optimizedRecipe = { gates: manifest.optimized.gates, formats: manifest.optimized.formats,
      turnFreezeHash: manifest.optimized.turnFreezeHash, gradeFreezeHash: manifest.optimized.gradeFreezeHash };
    for (const slot of manifest.plan) {
      const item = cases.get(slot.caseId)!;
      if (manifest.optimized.requestHashes[item.id] !== hash(foundryRequest({ state: item.state, questions: item.questions }, optimizedRecipe.formats[item.lane]!))) throw new Error('Optimized request changed');
    }
  }
  const lines = (await Bun.file(`${directory}/runs/${run}/results.jsonl`).text()).trim().split('\n');
  const entries = lines.filter(Boolean).map(line => JSON.parse(line));
  if (entries.length !== manifest.plan.length || new Set(entries.map(row => row.id)).size !== entries.length) throw new Error('Incomplete or duplicate run results');
  for (const [index, row] of entries.entries()) {
    const planned = manifest.plan[index];
    const item = cases.get(row.caseId);
    if (!item || row.caseId !== planned.caseId || row.arm !== planned.arm || row.repeat !== planned.repeat
      || row.inputHash !== planned.inputHash || row.inputHash !== hash({ state: item.state, questions: item.questions })) throw new Error('Result input or plan mismatch');
  }
  rows.push(...entries);
}
const paidAttempts = rows.length;
const freeze = await Bun.file(`${directory}/candidate-freeze.json`).json();
const gradeFreeze = await Bun.file(`${directory}/grade-candidate-freeze.json`).json();
rows.push(...rows.filter(row => row.arm === 'literal').map(row => ({ ...row, id: `${row.id}:calibrated`, arm: 'calibrated',
  ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output,
    { silence: freeze.selected.threshold, explored: gradeFreeze.selected.threshold }) } : {}) })));
const foundryFreezeFile = Bun.file(`${directory}/microsoft-candidate-freeze.json`);
const foundryFreeze = rows.some(row => row.arm.startsWith('foundry')) && await foundryFreezeFile.exists() ? await foundryFreezeFile.json() : null;
if (foundryFreeze) {
  if (foundryFreeze.corpusHash !== corpus.hash || foundryFreeze.goldHash !== hash(await Bun.file(`${directory}/grade-gold.json`).json())) throw new Error('Foundry gate freeze mismatch');
  if (!['silence', 'explored'].every(gate => Number.isFinite(foundryFreeze.selected[gate]) && foundryFreeze.selected[gate] >= 0 && foundryFreeze.selected[gate] <= 1)
    || !Number.isFinite(Date.parse(foundryFreeze.frozenAt))
    || rows.some(row => row.arm.startsWith('foundry') && row.split === 'validation' && (!Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) < Date.parse(foundryFreeze.frozenAt)))) throw new Error('Invalid or late Foundry gate freeze');
  rows.push(...rows.filter(row => row.arm.startsWith('foundry')).map(row => ({ ...row, id: `${row.id}:calibrated`, arm: `${row.arm}-calibrated`,
    ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output, foundryFreeze.selected) } : {}) })));
}
const hillFreezeFile = Bun.file(`${directory}/microsoft-hill-freeze.json`);
const hillFreeze = rows.some(row => row.arm.startsWith('foundry')) && await hillFreezeFile.exists() ? await hillFreezeFile.json() : null;
if (hillFreeze) {
  if (hillFreeze.corpusHash !== corpus.hash || hillFreeze.goldHash !== hash(await Bun.file(`${directory}/grade-gold.json`).json())
    || !Number.isFinite(Date.parse(hillFreeze.frozenAt)) || !['silence', 'explored'].every(gate => Number.isFinite(hillFreeze.selected[gate]) && hillFreeze.selected[gate] >= 0 && hillFreeze.selected[gate] <= 1)) throw new Error('Invalid hill-climb freeze');
  const format = (hillFreeze.arm === 'foundry' ? 'literal' : hillFreeze.arm.slice('foundry-'.length)) as FoundryFormat;
  for (const item of corpus.cases.filter(item => hillFreeze.unchangedLanes.includes(item.lane))) {
    const request = { state: item.state, questions: item.questions };
    if (hash(request) !== hash(foundryRequest(request, format))) throw new Error('Claimed unchanged lane has different inputs');
  }
  const selected = rows.filter(row => row.arm === (hillFreeze.unchangedLanes.includes(row.lane) ? 'foundry' : hillFreeze.arm)
    && (row.split === 'development' || hillFreeze.unchangedLanes.includes(row.lane) || row.id.startsWith(`${hillFreeze.validationRun}:`)));
  if (selected.some(row => row.id.startsWith(`${hillFreeze.validationRun}:`) && (!Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) < Date.parse(hillFreeze.frozenAt)))) throw new Error('Hill-climb candidate frozen after validation');
  rows.push(...selected.map(row => ({ ...row, id: `${row.id}:improved`, arm: 'foundry-improved',
    ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output, hillFreeze.selected) } : {}) })));
}
const goalFreezes: Record<string, unknown> = {};
for (const lane of ['turn', 'grade']) {
  const finalFile = Bun.file(`${directory}/microsoft-${lane}-goal-final-freeze.json`);
  const file = await finalFile.exists() ? finalFile : Bun.file(`${directory}/microsoft-${lane}-goal-freeze.json`);
  if (!await file.exists()) continue;
  const frozen = await file.json();
  if (frozen.corpusHash !== corpus.hash || frozen.goldHash !== hash(await Bun.file(`${directory}/${lane}-gold.json`).json())
    || !Number.isFinite(Date.parse(frozen.frozenAt)) || Object.values(frozen.gates).some(gate => typeof gate !== 'number' || !Number.isFinite(gate) || gate < 0 || gate > 1)) throw new Error('Invalid goal candidate freeze');
  const format = frozen.arm.slice('foundry-'.length) as FoundryFormat;
  for (const item of corpus.cases.filter(item => item.lane === lane)) {
    if (frozen.requestHashes[item.id] !== hash(foundryRequest({ state: item.state, questions: item.questions }, format))) throw new Error('Goal request changed after freeze');
  }
  const selected = rows.filter(row => row.arm === frozen.arm && row.lane === lane
    && (row.id.startsWith(`${frozen.developmentRun}:`) || row.id.startsWith(`${frozen.validationRun}:`)));
  if (selected.some(row => row.split === 'validation' && (!Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) < Date.parse(frozen.frozenAt)))) throw new Error('Goal candidate frozen after validation');
  goalFreezes[lane] = frozen;
  rows.push(...selected.map(row => ({ ...row, id: `${row.id}:goal`, arm: 'foundry-goal',
    ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output, frozen.gates) } : {}) })));
}
if (Object.keys(goalFreezes).length) rows.push(...rows.filter(row => row.arm === 'foundry' && row.lane === 'silence').map(row => ({ ...row,
  id: `${row.id}:goal`, arm: 'foundry-goal', ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output, { silence: .9, explored: .5 }) } : {}) })));
if (optimizedRecipe) {
  if (optimizedRecipe.turnFreezeHash !== hash(goalFreezes.turn) || optimizedRecipe.gradeFreezeHash !== hash(goalFreezes.grade)) throw new Error('Comparison differs from frozen Microsoft goal recipe');
  rows.push(...rows.filter(row => ['jev', 'literal', 'jev-optimized', 'literal-optimized'].includes(row.arm)).map(row => ({ ...row,
    id: `${row.id}:shared-gates`, arm: row.arm.endsWith('-optimized') ? `${row.arm}-calibrated` : `${row.arm}-shared-gates`,
    ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output, optimizedRecipe!.gates) } : {}) })));
}
const scored = rows.map(row => {
  const item = cases.get(row.caseId);
  if (!item) throw new Error('Unknown result case');
  const checks = scoreChecks(item.checks, row.output);
  const transport = row.status === 'ok';
  return { ...row, checks, labeled: checks.length > 0, passed: transport && checks.length > 0 && checks.every(check => check.pass) };
});
const quantile = (values: number[], fraction: number) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]!);
};
const summarize = (group: typeof scored) => {
  const labeled = group.filter(row => row.labeled);
  const checks = labeled.flatMap(row => row.checks);
  const silence = labeled.filter(row => row.lane === 'silence' && row.status === 'ok');
  const criticalCases = labeled.filter(row => row.checks.some(check => check.critical && !check.pass));
  const cases = [...new Set(labeled.map(row => row.caseId))];
  const dimensions = ['synthetic', 'coverage', 'reading', 'evidence', 'action'].map(dimension => {
    const selected = labeled.flatMap(row => row.checks.filter(check => {
      const kind = row.lane !== 'grade' ? 'action' : row.source === 'synthetic' ? 'synthetic'
        : check.path.includes('evidence') ? 'evidence' : check.path[0] === 'readings' ? 'reading' : 'coverage';
      return kind === dimension;
    }));
    return [dimension, { passed: selected.filter(check => check.pass).length, total: selected.length }];
  });
  return { attempts: group.length, usable: group.filter(row => row.status === 'ok').length,
    statuses: Object.fromEntries([...new Set(group.map(row => row.status))].map(status => [status, group.filter(row => row.status === status).length])),
    labeledAttempts: labeled.length, cases: cases.length, fullyPassed: labeled.filter(row => row.passed).length,
    checks: checks.length, passedChecks: checks.filter(check => check.pass).length,
    dimensions: Object.fromEntries(dimensions),
    meanCaseCheckAccuracy: cases.length ? cases.reduce((total, id) => { const entries = labeled.filter(row => row.caseId === id).flatMap(row => row.checks); return total + entries.filter(check => check.pass).length / entries.length; }, 0) / cases.length : null,
    criticalFailureCases: [...new Set(criticalCases.map(row => row.caseId))],
    latencyMs: { allP50: quantile(group.map(row => row.durationMs), .5), allP95: quantile(group.map(row => row.durationMs), .95),
      usableP50: quantile(group.filter(row => row.status === 'ok').map(row => row.durationMs), .5), usableP95: quantile(group.filter(row => row.status === 'ok').map(row => row.durationMs), .95) },
    brier: silence.length ? silence.reduce((sum, row) => sum + (Number(row.output!.probability) - Number(row.checks[0]!.expected)) ** 2, 0) / silence.length : null,
    falseContinues: silence.filter(row => row.output!.continue === true && row.checks[0]!.expected === false).length,
    missedContinues: silence.filter(row => row.output!.continue === false && row.checks[0]!.expected === true).length,
    inputTokens: group.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0),
    estimatedUsd: group.reduce((sum, row) => sum + (row.estimatedUsd ?? 0), 0), unknownCostAttempts: group.filter(row => row.estimatedUsd == null).length };
};
const groups = [...new Set(scored.map(row => `${row.split}/${row.arm}/${row.lane}`))];
const summary = Object.fromEntries(groups.map(key => [key, summarize(scored.filter(row => `${row.split}/${row.arm}/${row.lane}` === key))]));
const bySource = Object.fromEntries([...new Set(scored.map(row => `${row.split}/${row.arm}/${row.source}/${row.lane}`))].map(key => [key,
  summarize(scored.filter(row => `${row.split}/${row.arm}/${row.source}/${row.lane}` === key))]));
const result = { corpusHash: corpus.hash, goldHash: hash(gold), candidateFreeze: freeze, gradeCandidateFreeze: gradeFreeze, paidAttempts,
  foundryCandidateFreeze: foundryFreeze,
  foundryHillFreeze: hillFreeze,
  foundryGoalFreezes: goalFreezes,
  optimizedRecipe,
  derivedArm: 'calibrated and improved arms reuse the named source responses, latency and usage without additional API calls.', runs, summary, bySource,
  excludedCases: [...new Set(scored.filter(row => !row.labeled).map(row => row.caseId))],
  failures: scored.filter(row => row.status !== 'ok' || row.checks.some(check => !check.pass)).map(row => ({ id: row.id, caseId: row.caseId, arm: row.arm,
    split: row.split, status: row.status, failed: row.checks.filter(check => !check.pass) })),
  caseScores: scored.map(row => ({ id: row.id, caseId: row.caseId, arm: row.arm, passed: row.passed, labeled: row.labeled, passedChecks: row.checks.filter(check => check.pass).length, checks: row.checks.length })) };
const output = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (output) await Bun.write(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ summary, excludedCases: result.excludedCases }, null, 2));
