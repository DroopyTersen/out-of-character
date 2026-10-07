import { expect, test } from 'bun:test';
import { z } from 'zod';
import { validateSpec, type InterviewSpec } from './spec';

const base = {
  id: 'sample',
  version: 'sample-v1',
  interviewer: { name: 'Sam', voices: [{ id: 'sam-one', voice: 'one', label: 'One', presentation: 'Neutral', image: '/sam.png' }] },
  topics: [{ id: 'work', label: 'Work', objectives: [{ id: 'work-scope', label: 'Scope' }] }],
  readings: [{ id: 'specificity', label: 'Specificity', description: 'Concrete examples.' }],
  narrative: { id: 'sample-summary', version: 'sample-summary-v1', system: 'Summarize.', schema: z.object({ text: z.string() }) },
} satisfies InterviewSpec;

test('a valid spec comes back unchanged', () => {
  expect(validateSpec(base)).toBe(base);
});

test('duplicate objective ids, empty prompts and backwards idle limits are rejected', () => {
  const topics = [...base.topics, { id: 'more', label: 'More', objectives: [{ id: 'work-scope', label: 'Again' }] }];
  expect(() => validateSpec({ ...base, topics })).toThrow('Objective ids must be unique.');
  expect(() => validateSpec({ ...base, narrative: { ...base.narrative, system: ' ' } })).toThrow('Invalid interview spec sample');
  const limits = { durationSeconds: 60, idleWarningMs: 5000, idleTimeoutMs: 1000, pauseHoldMs: 0, maxResumes: 0 };
  expect(() => validateSpec({ ...base, limits })).toThrow('The idle warning must come before the idle timeout.');
});
