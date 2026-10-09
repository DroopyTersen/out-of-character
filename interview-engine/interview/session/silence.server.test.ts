import { expect, test } from 'bun:test';
import { judgeModel } from '../../providers/jevJudge.server';
import { evaluateSilence } from './silence.server';

test('the real Jev adapter preserves a silence probability and rejects malformed answers without retrying', async () => {
  // Only the paid HTTP boundary is substituted. Semantic accuracy is measured separately with the paid replay probe.
  for (const probability of [.07, .96, 1.2]) {
    let calls = 0;
    const request = Object.assign(async () => {
      calls++;
      return Response.json({ model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 10 },
        answers: { continue: { type: 'choice', choice: probability > .5 ? 'continue' : 'wait',
          probabilities: { continue: probability, wait: 1 - probability, finished: 0 } } } });
    }, { preconnect: fetch.preconnect });
    const work = evaluateSilence({ judge: judgeModel({ apiKey: 'fixture', fetch: request }),
      transcript: [{ id: 'p1', speaker: 'interviewer', text: 'Who used it?', startMs: 0, endMs: 1000 }] });
    if (probability > 1) await expect(work).rejects.toThrow();
    else expect(await work).toMatchObject({ probability, model: 'jev-1.13.0' });
    expect(calls).toBe(1);
  }
});
