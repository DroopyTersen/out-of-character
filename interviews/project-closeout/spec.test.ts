import { expect, test } from 'bun:test';
import { INTERVIEW_SCENARIO_ID, interviewSummarySchema, interviewTopics } from '../../core/interview';
import { SUMMARY_VERSION } from '../../ai/interview/summary.server';
import { spec } from './spec';

test('the closeout spec carries the closeout content the app already uses', async () => {
  expect(spec.id).toBe(INTERVIEW_SCENARIO_ID);
  expect(spec.topics).toBe(interviewTopics);
  expect(spec.narrative.schema).toBe(interviewSummarySchema);
  expect(spec.narrative.version).toBe('interview-summary-v1');
  expect(SUMMARY_VERSION).toBe(spec.narrative.version);
  expect(spec.narrative.system).toStartWith('Write a comprehensive, readable internal project-closeout summary');
  // Browser code imports ./public; the summary prompt must not be reachable from it.
  expect(await Bun.file(new URL('./public.ts', import.meta.url)).text()).not.toContain('narrative.prompt');
});
