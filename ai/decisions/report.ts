import { calibrate, hash, scoreChecks, type Check, type EvalCase } from './cases';
import type { Result } from '../../interview-engine/providers/decisionJudge.server';

type Row = { id: string; caseId: string; arm: string; lane: string; split: string; source: string; status: string; durationMs: number;
  estimatedUsd: number | null; output?: Record<string, unknown>; answers?: Result['answers']; usage?: { inputTokens: number; outputTokens: number } };
type Gold = { caseId: string; checks: Check[]; notes?: string };
const directory = '.data/openai-decisions-evals';
const corpus = await Bun.file(`${directory}/cases-v1.json`).json() as { hash: string; cases: EvalCase[] };
if (hash(corpus.cases) !== corpus.hash) throw new Error('Frozen corpus changed');
const gold: Gold[] = [];
for (const lane of ['turn', 'grade']) {
  const file = Bun.file(`${directory}/${lane}-gold.json`);
  if (await file.exists()) gold.push(...await file.json());
}
if (new Set(gold.map(item => item.caseId)).size !== gold.length) throw new Error('Duplicate gold case');
const cases = new Map(corpus.cases.map(item => [item.id, { ...item, checks: [...item.checks, ...gold.filter(row => row.caseId === item.id).flatMap(row => row.checks)] }]));
const runs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!runs.length || runs.some(run => !/^[\w.-]+$/.test(run))) throw new Error('Provide run directory IDs');
const rows: Row[] = [];
for (const run of runs) {
  const manifest = await Bun.file(`${directory}/runs/${run}/manifest.json`).json();
  if (manifest.corpusHash !== corpus.hash) throw new Error('Run corpus mismatch');
  const lines = (await Bun.file(`${directory}/runs/${run}/results.jsonl`).text()).trim().split('\n');
  rows.push(...lines.filter(Boolean).map(line => JSON.parse(line)));
}
const paidAttempts = rows.length;
const freeze = await Bun.file(`${directory}/candidate-freeze.json`).json();
const gradeFreeze = await Bun.file(`${directory}/grade-candidate-freeze.json`).json();
rows.push(...rows.filter(row => row.arm === 'literal').map(row => ({ ...row, id: `${row.id}:calibrated`, arm: 'calibrated',
  ...(row.output && row.answers ? { output: calibrate(cases.get(row.caseId)!, row.answers, row.output,
    { silence: freeze.selected.threshold, explored: gradeFreeze.selected.threshold }) } : {}) })));
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
        : check.path.includes('evidence') ? 'evidence' : 'coverage';
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
  derivedArm: 'calibrated reuses literal responses, latency and usage; it incurs no additional API calls', runs, summary, bySource,
  excludedCases: [...new Set(scored.filter(row => !row.labeled).map(row => row.caseId))],
  failures: scored.filter(row => row.status !== 'ok' || row.checks.some(check => !check.pass)).map(row => ({ id: row.id, caseId: row.caseId, arm: row.arm,
    split: row.split, status: row.status, failed: row.checks.filter(check => !check.pass) })),
  caseScores: scored.map(row => ({ id: row.id, caseId: row.caseId, arm: row.arm, passed: row.passed, labeled: row.labeled, passedChecks: row.checks.filter(check => check.pass).length, checks: row.checks.length })) };
const output = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
if (output) await Bun.write(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ summary, excludedCases: result.excludedCases }, null, 2));
