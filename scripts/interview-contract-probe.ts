/** Bounded synthetic checks of the accepted plan and independent report contracts.
 * bun --env-file=.dev.vars scripts/interview-contract-probe.ts --paid
 * Writes only synthetic evidence under output/interview-contract-probe/.
 */
import { foundryConfig } from '../ai/foundry.server';
import { resolveInterview } from '../interview-engine/interview/definition.server';
import { evaluateInterview } from '../interview-engine/interview/conversation/evaluate.server';
import { writeNarrative } from '../interview-engine/narrative/write.server';
import { createDecisionJudge } from '../interview-engine/providers/decisionJudge.server';
import { foundryProviders } from '../interview-engine/providers/providers.server';
import type { Passage } from '../interview-engine/shared/transcript';

if (!Bun.argv.includes('--paid')) throw new Error('Pass --paid for four synthetic judgments and one synthetic report.');
if (!process.env.OPENAI_API_KEY) throw new Error('Load the project provider credentials.');
const providers = foundryProviders({ ...foundryConfig(process.env), judge: createDecisionJudge({ apiKey: process.env.OPENAI_API_KEY }) });
const spec = resolveInterview({
  id: 'handoff-review', version: 'synthetic-v1', title: 'Handoff review', goals: 'Learn what made customer handoffs effective or difficult.',
  topics: [{ id: 'customer-handoff', label: 'Customer handoff', learn: 'Understand handoffs to the customer team, excluding internal engineering handoffs.',
    appliesWhen: 'The participant personally handled a handoff to the customer team.',
    topics: [{ id: 'missing-information', label: 'Missing information', learn: 'Describe missing information and its effect.' }],
  }],
  report: { audience: 'Delivery leads', format: 'Write a concise Markdown report with headings Findings and Root cause. State when the account does not establish a root cause. Do not organize by the topic tree.' },
}, { interviewer: { name: 'Sam', persona: 'Warm and direct.', voices: [{ id: 'cedar', voice: 'cedar', label: 'Cedar', presentation: 'Neutral', image: '/synthetic.png' }] } });
const dialogue = (question: string, answer: string): Passage[] => [
  { id: 'p1', speaker: 'interviewer', text: question, startMs: 0, endMs: 1000 },
  { id: 'p2', speaker: 'participant', text: answer, startMs: 1500, endMs: 8000 },
];
const cases = [
  { id: 'unknown', expected: 'unknown', explored: false, transcript: dialogue('What did the project deliver?', 'The project delivered a booking portal. It went live in May.') },
  { id: 'outside-responsibility', expected: 'not-applicable', explored: false, transcript: dialogue('What happened in the customer handoff?', 'I had no involvement in any customer handoff. Priya handled all of those; I only worked on internal tests.') },
  { id: 'relevant-and-covered', expected: 'applicable', explored: true, transcript: dialogue('What happened in the customer handoff?', 'I personally handed the portal to the customer team. The runbook was missing the VPN setup steps, so their team could not log in for two days. I added the steps and walked them through access.') },
  { id: 'parent-scope', expected: 'applicable', explored: false, transcript: dialogue('What happened in the handoffs?', 'I personally handled the handoff to the customer, but have not described that yet. Separately, our internal engineering handoff lacked a test command, costing our own developers an hour. That internal example has nothing to do with the customer handoff.') },
] as const;
const results = await Promise.allSettled(cases.map(async row => {
  const result = await evaluateInterview({ spec, passages: [...row.transcript], revision: 2, signal: AbortSignal.timeout(30_000) }, providers);
  const reading = result.objectives[0]!;
  return { id: row.id, passed: reading.applicability === row.expected && reading.achieved === row.explored, reading, durationMs: result.durationMs };
}));
const grades = results.map((result, index) => result.status === 'fulfilled' ? result.value : { id: cases[index]!.id, passed: false, error: result.reason instanceof Error ? result.reason.name : 'Provider failure' });
const input = {
  transcript: dialogue('The vendor caused a two-week customer delay, right?', 'I do not know whether any delay happened or what caused it. I only worked on internal tests. Priya handled customer handoffs; I was not involved.'),
  format: spec.plan.report,
  context: { participant: { name: 'Jordan' }, background: 'The organizer suspects a two-week delay caused by a vendor mistake. This is an unconfirmed hypothesis.' },
};
const run = writeNarrative(input, providers, AbortSignal.timeout(90_000));
for await (const _ of run.stream) { /* The final synthetic document is saved for review. */ }
const narrative = await run.result;
const output = { checkedAt: new Date().toISOString(), synthetic: true, grades, report: { input, ...narrative } };
await Bun.write('output/interview-contract-probe/result.json', JSON.stringify(output, null, 2) + '\n');
for (const result of grades) console.log(`${result.id}: ${result.passed ? 'passed' : 'FAILED'}`);
console.log(`Report: ${narrative.document ? 'generated for evidence review' : 'FAILED'}`);
if (grades.some(row => !row.passed) || !narrative.document) process.exitCode = 1;
