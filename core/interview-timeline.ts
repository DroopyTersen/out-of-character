// Moved to the engine; this wrapper names the closeout's objectives in grade rows, as before.
import * as engine from '../interview-engine/interview/replay/timeline';
import { interviewTopics } from '../interviews/project-closeout/public';

export { formatTimelineRows, interviewTurnGaps, parseTimelineExport, TIMELINE_LANES, type TimelineLane, type TimelineRow } from '../interview-engine/interview/replay/timeline';
export const producerTimeline = (input: Omit<Parameters<typeof engine.producerTimeline>[0], 'topics'>) => engine.producerTimeline({ ...input, topics: interviewTopics });
