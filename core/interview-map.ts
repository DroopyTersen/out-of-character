// Moved to the engine; this re-export keeps the practice simulator's imports working until Phase 5.
import { mapTopicIds } from '../interview-engine/interview/conversation/map';
import { interviewTopics } from '../interviews/project-closeout/public';

export * from '../interview-engine/interview/conversation/map';
/** The closeout's objective IDs, which its map threads may name as topics. */
export const MAP_TOPIC_IDS = mapTopicIds({ topics: interviewTopics });
