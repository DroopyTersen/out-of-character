import { lookupInterviewBackground } from '../interview-engine/reasoning/backgroundResearch.server';
import { foundryConfig } from '../ai/foundry.server';
import { foundryProvider } from '../interview-engine/providers/foundry.server';
import type { ResearchKind } from '../interview-engine/reasoning/conversationRecords';

if (!process.argv.includes('--paid')) throw new Error('Pass --paid to run this bounded synthetic provider smoke.');
const foundry = foundryConfig(process.env);
const provider = foundryProvider(foundry);
const model = provider.responses(foundry.fastModel);
const webSearch = provider.tools.webSearch({ searchContextSize: 'low' });

// Synthetic public names only. The producer chooses the name and clue; this checks the lookup's identity handling.
const scenarios: { label: string; kind: ResearchKind; name: string; clue: string | null }[] = [
  { label: 'canonical client identity', kind: 'organization', name: 'Cutter Associates', clue: 'investment-management research and consulting' },
  { label: 'client business overview', kind: 'organization', name: 'REI', clue: 'outdoor retailer' },
  { label: 'public technical term', kind: 'term', name: 'eIDAS', clue: 'EU electronic signatures' },
  { label: 'public program', kind: 'product', name: '3DEP', clue: 'USGS elevation program' },
  { label: 'ambiguous name without clue', kind: 'organization', name: 'Summit', clue: null },
];

for (const scenario of scenarios) {
  const started = performance.now();
  try {
    const result = await lookupInterviewBackground({ target: { kind: scenario.kind, name: scenario.name }, clue: scenario.clue, ...(scenario.name === 'Cutter Associates' ? { subject: 'Member-facing research assistant with cited answers' } : {}), model, webSearch, signal: AbortSignal.timeout(90_000) });
    if (scenario.name === 'Cutter Associates' && (result.status !== 'found' || result.matchedIdentity !== 'Cutter Associates' || result.facts.some(fact => /cutter consortium/i.test(fact.text)))) throw new Error('Canonical research identity failed.');
    console.log(JSON.stringify({ scenario: scenario.label, totalMs: Math.round(performance.now() - started), ...result }));
  } catch (error) {
    process.exitCode = 1;
    console.log(JSON.stringify({ scenario: scenario.label, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : 'UnknownError' }));
  }
}
