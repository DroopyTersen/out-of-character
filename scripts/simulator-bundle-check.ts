import { readFile } from 'node:fs/promises';
import { clients, scenarios } from '../ai/simulator/scenarios.server';
import { interviewCues, interviewers } from '../ai/interview/scenario.server';

// Workshop transcripts/results are intentional public examples. Actor direction,
// private reference text, rubric instructions, and credentials must stay server-side.
const privateText = [
  'Resistance follows your interests. Protect what matters to you',
  'You personally sponsored that failed rollout and took the blame',
  'Judge only the actual dialogue, with speakers identified',
  'Assess the CLIENT ACTOR, not the trainee',
  ...clients.map(client => client.behavior),
  ...scenarios.flatMap(scenario => scenario.cues.map(cue => cue.when)),
  ...interviewers.map(interviewer => interviewer.behavior),
  ...interviewCues.map(cue => cue.when),
];
let checked = 0;
for await (const path of new Bun.Glob('**/*.{js,json,css,html}').scan('build/client')) {
  const content = await readFile(`build/client/${path}`, 'utf8');
  if (privateText.some(text => content.includes(text)) || /["']?(?:assertiveness|skepticism|guardedness|bargaining|riskAversion)["']?\s*:|\bsk-[A-Za-z0-9_-]{32,}|\btsai_[A-Za-z0-9_-]{24,}/.test(content)) {
    throw new Error(`Private simulator content or a credential-shaped value reached build/client/${path}.`);
  }
  checked++;
}
if (!checked) throw new Error('Build the client before checking its contents.');
console.log(`Simulator boundary check passed for ${checked} client assets.`);
