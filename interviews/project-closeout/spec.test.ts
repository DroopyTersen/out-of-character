import { expect, test } from 'bun:test';
import { INTERVIEW_SCENARIO_ID, interviewSummarySchema, interviewTopics } from '../../core/interview';
import { SUMMARY_VERSION } from '../../ai/interview/summary.server';
import { spec } from './spec';

test('the closeout spec carries the closeout content the app already uses', async () => {
  expect(spec.id).toBe(INTERVIEW_SCENARIO_ID);
  // The browser's topics, plus Jev's criteria on every objective.
  expect(spec.topics.map(topic => ({ ...topic, objectives: topic.objectives.map(({ id, label }) => ({ id, label })) }))).toEqual(interviewTopics.map(topic => ({ ...topic, objectives: [...topic.objectives] })));
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) expect(objective.criterion).toEqual(expect.any(String));
  for (const reading of spec.readings) expect(reading.rubric.criteria).toHaveLength(5);
  expect(spec.narrative.schema).toBe(interviewSummarySchema);
  expect(spec.narrative.version).toBe('interview-summary-v1');
  expect(SUMMARY_VERSION).toBe(spec.narrative.version);
  expect(spec.narrative.system).toStartWith('Write a comprehensive, readable internal project-closeout summary');
  // Browser code imports ./public; the summary prompt and Jev's criteria must not be reachable from it.
  const browser = await Bun.file(new URL('./public.ts', import.meta.url)).text();
  expect(browser).not.toContain('narrative.prompt');
  expect(browser).not.toContain('rubric.prompt');
});
