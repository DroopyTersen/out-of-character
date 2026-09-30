import { lookupInterviewBackground } from '../ai/interview/research.server';
import { foundryConfig } from '../ai/foundry.server';
import type { ResearchKind } from '../core/interview-producer';

if (!process.argv.includes('--paid')) throw new Error('Pass --paid to run this bounded synthetic provider smoke.');
const foundry = foundryConfig(process.env);

// Synthetic public names only. The producer chooses the name and clue; this checks the lookup's identity handling.
const scenarios: { label: string; kind: ResearchKind; name: string; clue: string | null }[] = [
  { label: 'client business overview', kind: 'organization', name: 'REI', clue: 'outdoor retailer' },
  { label: 'public technical term', kind: 'term', name: 'eIDAS', clue: 'EU electronic signatures' },
  { label: 'public program', kind: 'product', name: '3DEP', clue: 'USGS elevation program' },
  { label: 'ambiguous name without clue', kind: 'organization', name: 'Summit', clue: null },
];

for (const scenario of scenarios) {
  const started = performance.now();
  try {
    const result = await lookupInterviewBackground({ target: { kind: scenario.kind, name: scenario.name }, clue: scenario.clue, foundry, signal: AbortSignal.timeout(25_000) });
    console.log(JSON.stringify({ scenario: scenario.label, totalMs: Math.round(performance.now() - started), ...result }));
  } catch (error) {
    console.log(JSON.stringify({ scenario: scenario.label, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : 'UnknownError' }));
  }
}
