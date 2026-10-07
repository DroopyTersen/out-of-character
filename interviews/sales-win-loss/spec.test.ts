import { expect, test } from 'bun:test';
import { validateSpec } from '../../interview-engine/shared/spec';
import { spec as closeout } from '../project-closeout/spec';
import { spec } from './spec';

const ids = (values: readonly { id: string }[]) => values.map(value => value.id);
const objectiveIds = (topics: typeof spec.topics | typeof closeout.topics) => topics.flatMap(topic => ids(topic.objectives));

test('the win/loss spec validates and fills every optional field', () => {
  expect(validateSpec(spec)).toBe(spec);
  expect(spec.limits).toBeDefined();
  expect(spec.limits.idleWarningMs).toBeLessThan(spec.limits.idleTimeoutMs);
  expect(spec.narrative.schema.parse({ text: '## Why they bought\n\nA renewal deadline.' })).toEqual({ text: '## Why they bought\n\nA renewal deadline.' });
  expect(spec.narrative.schema.safeParse({ text: ' ' }).success).toBe(false);
});

test('its ids are unique within the spec and distinct from the closeout spec', () => {
  for (const list of [ids(spec.topics), objectiveIds(spec.topics), ids(spec.readings), ids(spec.interviewer.voices)]) expect(new Set(list).size).toBe(list.length);
  expect(spec.id).not.toBe(closeout.id);
  expect(spec.narrative.id).not.toBe(closeout.narrative.id);
  const closeoutObjectives = new Set(objectiveIds(closeout.topics));
  expect(objectiveIds(spec.topics).filter(id => closeoutObjectives.has(id))).toEqual([]);
});

test('it shares no wording with the closeout spec and keeps its prompt out of the browser file', async () => {
  const labels = (s: typeof spec | typeof closeout) => [...s.topics.flatMap(topic => [topic.label, ...topic.objectives.map(objective => objective.label)]), ...s.readings.map(reading => reading.description)];
  const closeoutLabels = new Set(labels(closeout));
  expect(labels(spec).filter(label => closeoutLabels.has(label))).toEqual([]);
  expect(spec.narrative.system).not.toMatch(/closeout|project/i);
  const publicSource = await Bun.file(new URL('./public.ts', import.meta.url)).text();
  expect(publicSource).not.toContain('narrative.prompt');
  expect(publicSource).not.toMatch(/from '\.\.\//); // nothing from the closeout spec or the host
});

test('validateSpec rejects a broken copy of it', () => {
  const [first, ...rest] = spec.topics;
  const duplicated = [{ ...first, objectives: [...first.objectives, { id: 'vendor-outcome', label: 'Again' }] }, ...rest];
  expect(() => validateSpec({ ...spec, topics: duplicated })).toThrow('Objective ids must be unique.');
  expect(() => validateSpec({ ...spec, readings: [...spec.readings, spec.readings[0]] })).toThrow('Reading ids must be unique.');
  expect(() => validateSpec({ ...spec, id: 'Sales Win/Loss' })).toThrow('Invalid interview spec Sales Win/Loss');
  expect(() => validateSpec({ ...spec, interviewer: { ...spec.interviewer, voices: [] } })).toThrow('Invalid interview spec sales-win-loss');
  expect(() => validateSpec({ ...spec, limits: { ...spec.limits, idleWarningMs: spec.limits.idleTimeoutMs } })).toThrow('The idle warning must come before the idle timeout.');
  expect(() => validateSpec({ ...spec, narrative: { ...spec.narrative, system: '' } })).toThrow('Invalid interview spec sales-win-loss');
});
