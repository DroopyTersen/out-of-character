import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { interviewFixtures } from './fixtures';

// Reduce private synthetic replay output to the public Workshop examples.
const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const jevPath = option('jev');
const replayDir = option('replays');
const output = option('output') ?? 'ai/interview/recordings.json';
if (!jevPath || !replayDir) throw new Error('Provide --jev=<path> and --replays=<directory>.');

const jev = JSON.parse(await readFile(jevPath, 'utf8'));
if (jev.synthetic !== true || !Array.isArray(jev.rows)) throw new Error('Expected synthetic interview results.');
const fixtureIds = new Set(jev.rows.map((row: { fixtureId: string }) => row.fixtureId));
if (fixtureIds.size !== jev.rows.length || fixtureIds.size !== interviewFixtures.length || interviewFixtures.some(fixture => !fixtureIds.has(fixture.id))) throw new Error('Interview fixture results are incomplete or duplicated.');
const rows = [];
for (const row of jev.rows) {
  let replay;
  try { replay = JSON.parse(await readFile(join(replayDir, `${row.fixtureId}.json`), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (replay && (replay.synthetic !== true || replay.kind !== 'interview' || replay.fixture !== row.fixtureId || replay.rows.length !== 1 || replay.rows[0].audience !== 'actor')) throw new Error(`Invalid director replay for ${row.fixtureId}.`);
  const assessment = replay?.rows[0];
  const generation = assessment?.generation?.[0];
  const readings: Record<string, { value: number | null; evidence: unknown }> = row.participant.readings;
  rows.push({
    fixtureId: row.fixtureId,
    participant: {
      model: row.participant.model, durationMs: row.participant.durationMs,
      readings: Object.fromEntries(Object.entries(readings).map(([id, reading]) => [id, { value: reading.value, evidence: reading.evidence }])),
      objectives: row.participant.objectives.map((item: { id: string; achieved: boolean; evidence: unknown }) => ({ id: item.id, achieved: item.achieved, evidence: item.evidence })),
    },
    interviewer: {
      model: assessment ? replay.models.detector : row.interviewer.model,
      durationMs: assessment ? assessment.detectorDurationMs : row.interviewer.durationMs,
      signals: assessment ? assessment.signals : row.interviewer.signals,
      researchProbability: row.interviewer.researchProbability,
    },
    ...(assessment ? { director: {
      decision: assessment.decision, issueId: assessment.issueId,
      ...(generation ? { result: { action: generation.action, text: generation.text, evidenceIds: generation.evidenceIds, model: generation.model, durationMs: generation.durationMs } } : {}),
    } } : {}),
  });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ synthetic: true, collectedAt: jev.collectedAt, rubricVersion: jev.rubricVersion, source: 'Separate synthetic participant and producer replays; no live interview data', rows }, null, 2) + '\n');
console.log(`Saved ${rows.length} reduced synthetic Workshop recordings to ${output}.`);
