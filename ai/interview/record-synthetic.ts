import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { interviewFixtures } from './fixtures';
import { INTERVIEW_RUBRIC_VERSION } from './rubric';
import type { InterviewObjectiveReading } from '../../core/interview';

// Reduce private synthetic replay output to the public Workshop examples.
const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const jevPath = option('jev');
const output = option('output') ?? 'ai/interview/recordings.json';
if (!jevPath) throw new Error('Provide --jev=<path>.');

const jev = JSON.parse(await readFile(jevPath, 'utf8'));
if (jev.synthetic !== true || !Array.isArray(jev.rows)) throw new Error('Expected synthetic interview results.');
if (jev.rubricVersion !== INTERVIEW_RUBRIC_VERSION) throw new Error('Recordings must use the current interview rubric.');
const fixtureIds = new Set(jev.rows.map((row: { fixtureId: string }) => row.fixtureId));
if (fixtureIds.size !== jev.rows.length || fixtureIds.size !== interviewFixtures.length || interviewFixtures.some(fixture => !fixtureIds.has(fixture.id))) throw new Error('Interview fixture results are incomplete or duplicated.');
const rows = [];
for (const row of jev.rows) {
  rows.push({
    fixtureId: row.fixtureId,
    participant: {
      model: row.participant.model, durationMs: row.participant.durationMs,
      objectives: row.participant.objectives.map(({ id, level, levels, probability, achieved, evidence }: InterviewObjectiveReading) => ({ id, level, levels, probability, achieved, evidence })),
    },
  });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: jev.collectedAt, rubricVersion: jev.rubricVersion, source: 'Synthetic participant replays; no live interview data', rows }, null, 2) + '\n');
console.log(`Saved ${rows.length} reduced synthetic Workshop recordings to ${output}.`);
