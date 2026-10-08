import { expect, test } from 'bun:test';
import { mapInstructions, mapSeed, type MappedSpec } from '../../interview-engine/interview/conversation/map.prompt';
import { interviewQuestions, type JudgedSpec } from '../../interview-engine/interview/conversation/rubric.prompt';
import { interviewerBrief, interviewOpening, type BriefedSpec } from '../../interview-engine/interview/voice/brief.server';
import { NOTE_CHANNELS } from '../../interview-engine/interview/voice/channel';
import { validateSpec } from '../../interview-engine/shared/spec';
import type { Passage } from '../../interview-engine/shared/transcript';
import { spec as closeout } from '../project-closeout/spec';
import { spec } from './spec';

const ids = (values: readonly { id: string }[]) => values.map(value => value.id);
const objectiveIds = (topics: typeof spec.topics | typeof closeout.topics) => topics.flatMap(topic => ids(topic.objectives));

// The engine reads the whole spec: a session would brief the interviewer, keep the map and grade from it.
spec satisfies BriefedSpec & JudgedSpec & MappedSpec;

/** Wording that belongs to the closeout. `delivery team` is only checked where the spec supplies the text. */
const closeoutTerms = [/closeout/i, /project customer/i, /Open on what they built/, /Next-team scenario/];
const noCloseout = (text: string, alsoDeliveryTeam = true) => {
  for (const term of alsoDeliveryTeam ? [...closeoutTerms, /delivery team/i] : closeoutTerms) expect(text).not.toMatch(term);
};
const passages: Passage[] = [
  { id: 'p1', speaker: 'interviewer', text: 'What were you buying, and how did it turn out?', startMs: 0, endMs: 3000 },
  { id: 'p2', speaker: 'participant', text: 'A ticketing platform. We went with the other vendor in the end.', startMs: 4000, endMs: 9000 },
];

test('the win/loss spec validates and fills every optional field', () => {
  expect(validateSpec(spec)).toBe(spec);
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) expect(objective.criterion).toEqual(expect.any(String));
  for (const reading of spec.readings) expect(reading.rubric.criteria).toHaveLength(5);
  expect(Object.values(spec.framing).every(value => value.trim().length > 0)).toBe(true);
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
  for (const file of ['brief.prompt.ts', 'framing.prompt.ts', 'rubric.prompt.ts']) noCloseout(await Bun.file(new URL(`./${file}`, import.meta.url)).text());
  const publicSource = await Bun.file(new URL('./public.ts', import.meta.url)).text();
  expect(publicSource).not.toMatch(/\.prompt'/);
  expect(publicSource).not.toMatch(/from '\.\.\//); // nothing from the closeout spec or the host
});

test('the engine renders a coherent brief for every voice and note channel', () => {
  for (const voice of spec.interviewer.voices) {
    for (const channel of NOTE_CHANNELS) {
      const brief = interviewerBrief(spec, voice.id, channel);
      expect(brief).toStartWith(`You are Sam, ${spec.interviewer.role}.`);
      for (const part of [...spec.interviewer.orientation, ...spec.interviewer.boundaries]) expect(brief).toContain(part);
      expect(brief).toContain('1. Anchor on the decision.');
      expect(brief).toContain('11. Rewind the decision.');
      noCloseout(brief);
    }
    expect(interviewOpening(spec, voice.id)).toContain(spec.interviewer.opening);
  }
});

test('the engine renders map instructions and a seed from its own topics', () => {
  const seed = mapSeed(spec);
  expect(seed).toStartWith(`PURPOSE\n${spec.framing.purpose}\n\nSETTING\n${spec.framing.setting}\n\nDEBRIEF TOPICS (id - label: what explored means)`);
  for (const topic of spec.topics) {
    expect(seed).toContain(topic.label);
    for (const objective of topic.objectives) expect(seed).toContain(`- ${objective.id} - ${objective.label}: ${objective.criterion}`);
  }
  noCloseout(seed);
  const instructions = mapInstructions(spec);
  expect(instructions).toStartWith('You are Sol, the producer behind Sam, an AI voice interviewer in a buyer’s win/loss debrief.');
  expect(instructions).toContain(`- ${spec.framing.defaultThread}`);
  expect(instructions).toContain('Debrief topics are your bookkeeping');
  // The map's fictional examples still come from a delivery project; see the engine README.
  noCloseout(instructions, false);
});

test('the engine renders Jev’s rubric from its own readings and topics', () => {
  const questions = interviewQuestions(spec, passages);
  for (const reading of spec.readings) expect(questions[`reading:${reading.id}`]).toMatchObject({ type: 'score', instructions: { task: reading.rubric.task }, criteria: [...reading.rubric.criteria] });
  for (const objective of spec.topics.flatMap(topic => topic.objectives)) {
    expect(questions[`objective:${objective.id}`]).toMatchObject({ instructions: { task: expect.stringContaining(`How far has the participant covered this debrief topic? ${objective.criterion}`), party: spec.framing.party } });
  }
  const text = JSON.stringify(questions);
  expect(text).toContain('Speakers are participant and sam (the interviewer); the vendor means the company the debrief is for');
  noCloseout(text);
});

test('validateSpec rejects a broken copy of it', () => {
  const [first, ...rest] = spec.topics;
  if (!first) throw new Error('Expected a topic.');
  const duplicated = [{ ...first, objectives: [...first.objectives, { id: 'vendor-outcome', label: 'Again' }] }, ...rest];
  expect(() => validateSpec({ ...spec, topics: duplicated })).toThrow('Objective ids must be unique.');
  expect(() => validateSpec({ ...spec, readings: [...spec.readings, spec.readings[0]!] })).toThrow('Reading ids must be unique.');
  expect(() => validateSpec({ ...spec, id: 'Sales Win/Loss' })).toThrow('Invalid interview spec Sales Win/Loss');
  expect(() => validateSpec({ ...spec, interviewer: { ...spec.interviewer, voices: [] } })).toThrow('Invalid interview spec sales-win-loss');
  expect(() => validateSpec({ ...spec, limits: { ...spec.limits, idleWarningMs: spec.limits.idleTimeoutMs } })).toThrow('The idle warning must come before the idle timeout.');
  expect(() => validateSpec({ ...spec, narrative: { ...spec.narrative, system: '' } })).toThrow('Invalid interview spec sales-win-loss');
});
