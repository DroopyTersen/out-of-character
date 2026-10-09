import { expect, test } from 'bun:test';
import { resolveInterview } from '../../interview-engine/interview/definition.server';
import { mapSeed } from '../../interview-engine/interview/conversation/map.prompt';
import { interviewQuestions } from '../../interview-engine/interview/conversation/rubric.prompt';
import { interviewerBrief } from '../../interview-engine/interview/voice/brief.server';
import { spec as closeout } from '../project-closeout/spec';
import { spec } from './spec';

test('a second plan supplies its own learning content to the voice, map and coverage judge', () => {
  expect(spec.id).not.toBe(closeout.id);
  const closeoutIds = new Set(closeout.topics.flatMap(group => group.objectives.map(topic => topic.id)));
  expect(spec.topics.flatMap(group => group.objectives).some(topic => closeoutIds.has(topic.id))).toBe(false);
  const seed = mapSeed(spec);
  expect(seed).toContain(spec.plan.goals);
  expect(seed).not.toMatch(/project closeout/i);
  const questions = interviewQuestions(spec, [{ id: 'p1', speaker: 'participant', text: 'We chose the other vendor.', startMs: 0, endMs: 1000 }]);
  for (const topic of spec.topics.flatMap(group => group.objectives)) {
    expect(seed).toContain(topic.criterion);
    expect(questions[`objective:${topic.id}`]).toMatchObject({ type: 'choice', instructions: { task: expect.stringContaining(topic.criterion) } });
  }
  for (const voice of spec.interviewer.voices) {
    expect(interviewerBrief(spec, voice.id)).toContain(spec.plan.goals);
    expect(interviewerBrief(spec, voice.id)).not.toMatch(/project closeout/i);
  }
});

test('runtime configuration rejects duplicate voices/readings and invalid session limits', () => {
  expect(() => resolveInterview(spec.plan, { ...spec.config, interviewer: { ...spec.config.interviewer, voices: [] } })).toThrow();
  expect(() => resolveInterview(spec.plan, { ...spec.config, readings: [...spec.config.readings, spec.config.readings[0]!] })).toThrow('unique');
  expect(() => resolveInterview(spec.plan, { ...spec.config, limits: { ...spec.config.limits!, idleWarningMs: spec.config.limits!.idleTimeoutMs } })).toThrow('warning');
});
