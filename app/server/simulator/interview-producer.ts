// Moved to the engine; this wrapper gives the practice simulator's producer the closeout spec until Phase 5.
import * as engine from '../../../interview-engine/interview/conversation/producer.server';
import { spec } from '../../../interviews/project-closeout/spec';

export { producerServices, type ProducerCheckpoint } from '../../../interview-engine/interview/conversation/producer.server';

type Options = ConstructorParameters<typeof engine.InterviewProducer>[0];
export class InterviewProducer extends engine.InterviewProducer {
  constructor(options: Omit<Options, 'spec'> & { spec?: Options['spec'] }) {
    super({ spec, ...options });
  }
}
