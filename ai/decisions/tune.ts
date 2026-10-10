import { calibrate, hash, scoreChecks, type Check, type EvalCase } from './cases';
import type { Result } from '../../interview-engine/providers/decisionJudge.server';

// Offline, development-only search. It never dispatches model calls or changes the application.
const directory = '.data/openai-decisions-evals';
const corpus = await Bun.file(`${directory}/cases-v1.json`).json() as { hash: string; cases: EvalCase[] };
if (hash(corpus.cases) !== corpus.hash) throw new Error('Frozen corpus changed');
const gold = await Bun.file(`${directory}/grade-gold.json`).json() as { caseId: string; checks: Check[] }[];
const cases = new Map(corpus.cases.filter(item => item.split === 'development' && item.lane === 'grade')
  .map(item => [item.id, { ...item, checks: [...item.checks, ...gold.filter(row => row.caseId === item.id).flatMap(row => row.checks)] }]));
const runs = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (!runs.length || runs.some(run => !/^[\w.-]+$/.test(run))) throw new Error('Provide development run IDs');
type Row = { caseId: string; arm: string; split: string; lane: string; inputHash: string; status: string; answers: Result['answers']; output: Record<string, unknown> };
const rows: Row[] = [];
for (const run of runs) {
  const manifest = await Bun.file(`${directory}/runs/${run}/manifest.json`).json();
  const entries: Row[] = (await Bun.file(`${directory}/runs/${run}/results.jsonl`).text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (manifest.corpusHash !== corpus.hash || entries.length !== manifest.plan.length) throw new Error('Incomplete or changed input run');
  rows.push(...entries.filter(row => row.lane === 'grade'));
}
const grid = [.30, .35, .40, .45, .50, .60, .70, .80, .85];
const candidates = [...new Set(rows.map(row => row.arm))].flatMap(arm => {
  const selected = rows.filter(row => row.arm === arm);
  if (!arm.startsWith('foundry') || selected.length !== cases.size || new Set(selected.map(row => row.caseId)).size !== cases.size) throw new Error('Each arm must cover every development grade exactly once');
  for (const row of selected) {
    const item = cases.get(row.caseId);
    if (!item || row.split !== 'development' || row.status !== 'ok' || row.inputHash !== hash({ state: item.state, questions: item.questions })) throw new Error('Invalid development response');
  }
  const satisfactionGrid = selected.some(row => Object.keys(row.answers).some(id => id.endsWith(':satisfied'))) ? [.6, .7, .8, .9, .95] : [undefined];
  return grid.flatMap(explored => satisfactionGrid.map(satisfied => {
    const checks = selected.flatMap(row => {
      const item = cases.get(row.caseId)!;
      return scoreChecks(item.checks, calibrate(item, row.answers, row.output, { silence: .9, explored, satisfied }))
        .map(check => ({ ...check, source: item.source }));
    });
    const primary = checks.filter(check => check.source === 'synthetic' || check.path.at(-1) === 'level');
    const falseCredit = checks.filter(check => check.path.at(-1) === 'achieved' && check.expected === false && check.actual === true
      || check.path.at(-1) === 'level' && check.actual === 'explored' && !(Array.isArray(check.expected) ? check.expected.includes('explored') : check.expected === 'explored')).length;
    return { arm, explored, ...(satisfied === undefined ? {} : { satisfied }), passed: primary.filter(check => check.pass).length, total: primary.length, falseCredit,
      coverage: checks.filter(check => check.source !== 'synthetic' && check.path.at(-1) === 'level' && check.pass).length,
      synthetic: checks.filter(check => check.source === 'synthetic' && check.pass).length,
      reading: checks.filter(check => check.source !== 'synthetic' && check.path[0] === 'readings' && !check.path.includes('evidence') && check.pass).length,
      criticalFailures: checks.filter(check => check.critical && !check.pass).length };
  }));
});
const selected = candidates.filter(row => row.falseCredit === 0 && row.criticalFailures === 0)
  .sort((a, b) => b.passed - a.passed || Number(b.arm === 'foundry') - Number(a.arm === 'foundry') || b.reading - a.reading || b.explored - a.explored || (('satisfied' in b ? Number(b.satisfied) : 1) - ('satisfied' in a ? Number(a.satisfied) : 1)) || a.arm.localeCompare(b.arm))[0];
if (!selected) throw new Error('No candidate meets the development safeguards');
const result = { createdAt: new Date().toISOString(), corpusHash: corpus.hash, goldHash: hash(gold), inputRuns: runs, grid, candidates, selected,
  rule: 'Zero false explored credit and zero critical failures; maximize real coverage plus synthetic assertions. Prefer the unchanged native request on a primary tie, then real reading checks and highest tied explored and satisfaction thresholds. Remaining ties use arm name.',
  limitation: 'Development selection only. Baseline validation was already inspected; subsequent validation is a regression replay, not a new untouched holdout.' };
const output = process.argv.find(value => value.startsWith('--out='))?.slice(6);
if (output) {
  if (await Bun.file(output).exists()) throw new Error('Refusing to overwrite a frozen search');
  await Bun.write(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ selected, bestByArm: [...new Set(candidates.map(row => row.arm))].map(arm => candidates.filter(row => row.arm === arm)
  .sort((a, b) => a.falseCredit - b.falseCredit || a.criticalFailures - b.criticalFailures || b.passed - a.passed || b.explored - a.explored)[0]) }, null, 2));
