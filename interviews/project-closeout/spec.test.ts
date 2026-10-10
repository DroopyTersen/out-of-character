import { expect, test } from 'bun:test';
import { INTERVIEW_SCENARIO_ID, interviewSummarySchema, interviewTopics } from '../../core/interview';
import { SUMMARY_VERSION } from '../../ai/interview/summary.server';
import { mapSeed } from '../../interview-engine/interview/conversation/map.prompt';
import { spec } from './spec';

test('the closeout spec carries the closeout content the app already uses', async () => {
  expect(spec.id).toBe(INTERVIEW_SCENARIO_ID);
  // The browser's topics, plus Jev's criteria on every objective.
  expect(spec.topics.map(topic => ({ ...topic, objectives: topic.objectives.map(({ id, label }) => ({ id, label })) }))).toEqual(interviewTopics.map(topic => ({ ...topic, objectives: [...topic.objectives] })));
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) expect(objective.criterion).toEqual(expect.any(String));
  for (const reading of spec.readings) expect(reading.rubric.criteria).toHaveLength(5);
  expect(spec.plan.report.audience).toContain('internal delivery team');
  expect(SUMMARY_VERSION).toBe('interview-narrative-v2');
  // Browser code imports ./public; the summary prompt and Jev's criteria must not be reachable from it.
  const browser = await Bun.file(new URL('./public.ts', import.meta.url)).text();
  expect(browser).not.toContain('narrative.prompt');
  expect(browser).not.toContain('rubric.prompt');
});

test('the map seed names every closeout topic with what explored means', () => {
  expect(mapSeed(spec)).toContain('- client-pace - Pace & approvals: The participant describes the actual pace');
});

test('the closeout catalog carries the six expanded objectives as universal topics, and the seed names what explored means for each', () => {
  const ids = spec.topics.flatMap(topic => topic.objectives.map(item => item.id));
  expect(ids).toHaveLength(20);
  expect(ids.indexOf('project-purpose')).toBeLessThan(ids.indexOf('project-delivery'));
  expect(ids.indexOf('project-outcome')).toBe(ids.indexOf('project-delivery') + 1);
  expect(spec.topics.find(topic => topic.id === 'client')!.objectives.at(-1)!.id).toBe('client-needs');
  const setup = spec.topics.find(topic => topic.id === 'setup')!;
  expect(setup.label).toBe('How the work was set up');
  expect(spec.topics.map(topic => topic.id)).toEqual(['project', 'client', 'setup', 'process']);
  expect(setup.objectives.map(item => item.id)).toEqual(['setup-alignment', 'setup-quality', 'setup-technical']);
  const seed = mapSeed(spec);
  expect(seed).toContain('- project-purpose - Why the client needed it: The participant describes the problem or need');
  expect(seed).toContain('- project-outcome - Success & how it landed: The participant describes how the client judged success');
  expect(seed).toContain('- client-needs - Needs beyond the scope:');
  expect(seed).toContain('- setup-alignment - Shared starting picture:');
  expect(seed).toContain('- setup-quality - What “done” meant:');
  // Universal, so coverage adapts through set-aside rather than a role branch: the criterion says so.
  expect(seed).toContain('- setup-technical - Technical fit with the client:');
  expect(setup.objectives.at(-1)!.criterion).toContain('set it aside');
  // The version pins what an attempt started under; content changes bump it.
  expect(spec.version).toBe('project-closeout-v4');
  // No role branches or scripted angles: every objective is a bare id, label and criterion.
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) expect(Object.keys(objective).sort()).toEqual(['criterion', 'id', 'label']);
  for (const id of ['project-purpose', 'project-outcome', 'client-needs', 'setup-alignment', 'setup-quality', 'setup-technical']) expect(Object.keys(spec.topics.flatMap(topic => topic.objectives).find(item => item.id === id)!).sort()).toEqual(['criterion', 'id', 'label']);
});
