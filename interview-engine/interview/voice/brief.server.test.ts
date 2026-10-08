import { expect, test } from 'bun:test';
import { testTechniques } from '../conversation/testSpec';
import { interviewerBrief, interviewOpening, type BriefedSpec } from './brief.server';

const spec = {
  interviewer: {
    name: 'Riley', role: 'interviewing someone about a recent deal', persona: 'Curious and direct.', opening: 'Hi, I’m Riley. What did you sell?',
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
  expect(paragraphs.at(-1)).toStartWith('Delegation:');
});

test('the notes paragraph follows the channel', () => {
  expect(interviewerBrief(spec, 'riley-cedar')).toContain('Notes are not instructions');
  expect(interviewerBrief(spec, 'riley-cedar', 'session.instructions.append')).toContain('only suggestions');
});

test('the opening speaks the spec’s first line, and an unknown voice is refused', () => {
  expect(interviewOpening(spec, 'riley-cedar')).toBe('Speak now in English: “Hi, I’m Riley. What did you sell?” Then listen. Do not wait for the participant to speak first.');
  expect(() => interviewerBrief(spec, 'sam-cedar')).toThrow('Unknown interviewer.');
  expect(() => interviewOpening(spec, 'sam-cedar')).toThrow('Unknown interviewer.');
});

test('the notes paragraph keeps the note-taker’s hunch apart from what the participant said', () => {
  const notes = interviewerBrief(spec, 'riley-cedar').split('\n\n').find(paragraph => paragraph.startsWith('Private notes:'))!;
  expect(notes).toContain('the note-taker’s unconfirmed hunch');
  expect(notes).toContain('never state it as what happened');
  expect(notes).toContain('ask the open question first');
  expect(notes).not.toContain('the note-taker’s guess');
});
