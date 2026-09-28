import { lookupInterviewBackground, prepareInterviewResearch } from '../ai/interview/research.server';

if (!process.argv.includes('--paid')) throw new Error('Pass --paid to run this bounded synthetic provider smoke.');
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required.');

const scenarios = [
  { label: 'client business overview', text: 'Our client was REI. We built a returns portal on Azure. I owned the import job.' },
  { label: 'technical gap after client overview', text: 'Our client was REI. I designed an identity flow around the EU eIDAS framework. Qualified electronic signatures had a specific public meaning that shaped our choice.', alreadyResearched: ['organization:rei'] },
  { label: 'public term gap', text: 'Our county flood team used the USGS 3D Elevation Program, or 3DEP, to decide which places to survey first. The program coverage shaped the tradeoff we made.' },
  { label: 'private discussion', text: 'I changed an internal project budget after a private conversation with a coworker.' },
];

for (const scenario of scenarios) {
  const signal = AbortSignal.timeout(25_000);
  const transcript = [{ id: 'p1', speaker: 'trainee' as const, text: scenario.text, startMs: 0, endMs: 4000 }];
  const started = performance.now();
  try {
    const target = await prepareInterviewResearch({ transcript, alreadyResearched: scenario.alreadyResearched, apiKey, signal });
    const preparationMs = Math.round(performance.now() - started);
    if (!target) {
      console.log(JSON.stringify({ scenario: scenario.label, preparationMs, target: null }));
      continue;
    }
    const result = await lookupInterviewBackground({ target, apiKey, signal });
    console.log(JSON.stringify({ scenario: scenario.label, preparationMs, totalMs: Math.round(performance.now() - started),
      target: { kind: target.kind, name: target.name }, queries: result?.queries ?? [], facts: result?.facts ?? [] }));
  } catch (error) {
    console.log(JSON.stringify({ scenario: scenario.label, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : 'UnknownError' }));
  }
}
