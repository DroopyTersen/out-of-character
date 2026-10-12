import { expect, test } from 'bun:test';
import { INTERVIEW_SCENARIO_ID, interviewSummarySchema, interviewTopics } from '../../core/interview';
import { SUMMARY_VERSION } from '../../ai/interview/summary.server';
import { mapSeed } from '../../interview-engine/reasoning/conversationMap.prompt';
import { spec } from './spec';

test('the closeout spec carries the closeout content the app already uses', async () => {
  expect(spec.id).toBe(INTERVIEW_SCENARIO_ID);
  // The browser's topics, plus Jev's criteria on every objective.
  expect(spec.topics.map(topic => ({ ...topic, objectives: topic.objectives.map(({ id, label }) => ({ id, label })) }))).toEqual(interviewTopics.map(topic => ({ ...topic, objectives: [...topic.objectives] })));
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) expect(objective.criterion).toEqual(expect.any(String));
  expect(spec.report.audience).toContain('internal delivery team');
  expect(SUMMARY_VERSION).toBe('interview-narrative-v2');
  // Browser code imports ./public; the summary prompt and Jev's criteria must not be reachable from it.
  const browser = await Bun.file(new URL('./public.ts', import.meta.url)).text();
  expect(browser).not.toContain('narrative.prompt');
  expect(browser).not.toContain('rubric.prompt');
});

test('closeout separates intended success from observed outcomes and carries visibility conditions to both readers', () => {
  const objectives = spec.topics.flatMap(topic => topic.objectives);
  const byId = (id: string) => objectives.find(topic => topic.id === id)!;
  expect(byId('project-success')).toBeDefined();
  expect(byId('project-outcome')).toBeDefined();
  expect(byId('project-success').criterion).not.toBe(byId('project-outcome').criterion);
  expect(byId('project-role').appliesWhen).toBeUndefined();
  for (const id of ['client-pace', 'setup-quality', 'setup-technical']) {
    expect(byId(id).appliesWhen).toBeTruthy();
    expect(mapSeed(spec)).toContain(byId(id).appliesWhen!);
  }
});
