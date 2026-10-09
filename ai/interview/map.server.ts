// Moved to the engine, where the prompt takes a spec. This wrapper binds the closeout spec so the practice simulator,
// probes and scripts keep their imports and signatures until Phase 5.
import * as engine from '../../interview-engine/interview/conversation/map.server';
import type { ConversationMap } from '../../interview-engine/interview/conversation/map';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec } from '../../interviews/project-closeout/spec';

export {
  emptyMapLog, MAP_EFFORT, MAP_MAX_OUTPUT_TOKENS, MAP_PROMPT_VERSION, mapCacheKey, MapOutputError, researchLogEvent, settledPrefix, unloggedPassages,
  type MapLog, type MapLogEvent, type MapTail,
} from '../../interview-engine/interview/conversation/map.server';

export const mapInstructions = engine.mapInstructions(spec);
export const mapSeed = () => engine.mapSeed(spec);
export const mapOutputSchema = engine.mapOutputSchema(spec);
export const mapWireSchema = engine.mapWireSchema(spec);
export const appendMapLog = (log: engine.MapLog, settled: Passage[], events?: engine.MapLogEvent[]) => engine.appendMapLog(spec, log, settled, events);
export const renderMapTail = (previous: ConversationMap, tail: engine.MapTail) => engine.renderMapTail(spec, previous, tail);
export const mapMessages = (blocks: string[], tail: string) => engine.mapMessages(spec, blocks, tail);
export const generateMap = (input: Omit<Parameters<typeof engine.generateMap>[0], 'spec'>) => engine.generateMap({ ...input, spec });
