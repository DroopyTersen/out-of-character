import { expect, test } from 'bun:test';
import { testTechniques } from '../conversation/testSpec';
import { interviewerBrief, interviewOpening, type BriefedSpec } from './brief.server';

const spec = {
  interviewer: {
    name: 'Riley', role: 'interviewing someone about a recent deal', persona: 'Curious and direct.',
    orientation: ['ORIENTATION ONE', 'ORIENTATION TWO'], boundaries: ['BOUNDARY ONE'], techniques: testTechniques,
    voices: [{ id: 'riley-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/riley.png' }],
  },
} satisfies BriefedSpec;

test('the brief puts the spec’s ground rules before the engine’s turn-taking, techniques and notes', () => {
  const paragraphs = interviewerBrief(spec, 'riley-cedar').split('\n\n');
  expect(paragraphs.slice(0, 4)).toEqual(['You are Riley, interviewing someone about a recent deal. Curious and direct.', 'ORIENTATION ONE', 'ORIENTATION TWO', 'BOUNDARY ONE']);
  expect(paragraphs[4]).toStartWith('Turn-taking:');
  expect(paragraphs[6]).toStartWith('The participant decides when the interview ends');
  expect(paragraphs[7]).toStartWith('Technique guide.');
  const guide = paragraphs[7]!.split('\n');
  expect(guide[1]).toBe('1. TEST GROUNDING. Ground it. When: First. How: One question. Sounds like: “What is it?”');
  expect(guide[11]).toBe('11. TEST LESSON. Draw the lesson. When: After a story. How: Ask what to do next time.');
  expect(guide).toHaveLength(14);
  expect(paragraphs[8]).toStartWith('Private notes:');
  expect(paragraphs.some(paragraph => paragraph.startsWith('Delegation:'))).toBe(true);
});

test('both the brief and the opening refuse an unknown voice', () => {
  expect(() => interviewerBrief(spec, 'sam-cedar')).toThrow('Unknown interviewer.');
  expect(() => interviewOpening(spec, 'sam-cedar')).toThrow('Unknown interviewer.');
});
