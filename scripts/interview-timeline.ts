/**
 * Prints one interview's producer timeline from a locally exported `interview_attempts` row.
 * Usage: bun scripts/interview-timeline.ts <row.json>. Reads only the file; makes no network or model call.
 */
import { producerLatency } from '../core/interview-producer';
import { formatTimelineRows, parseTimelineExport, producerTimeline, TIMELINE_LANES, type TimelineLane } from '../core/interview-timeline';

const [path, ...flags] = Bun.argv.slice(2);
if (!path) throw new Error('Usage: bun scripts/interview-timeline.ts <row.json> [--lanes=dialogue,producer,research,rundown]');
const lanes = flags.find(flag => flag.startsWith('--lanes='))?.slice(8).split(',') as TimelineLane[] | undefined;
if (lanes?.some(lane => !TIMELINE_LANES.includes(lane))) throw new Error(`Lanes are ${TIMELINE_LANES.join(', ')}.`);
const source = parseTimelineExport(await Bun.file(path).json());
console.log(formatTimelineRows(producerTimeline(source).filter(row => !lanes || lanes.includes(row.lane))));
console.log('\nLatency (ms)');
for (const [name, stat] of Object.entries(producerLatency(source.records))) console.log(`  ${name.padEnd(13)} ${stat ? `p50 ${stat.p50}  p90 ${stat.p90}  n ${stat.count}` : '—'}`);
