import { expect, test } from 'bun:test';
import { interviewerBrief, interviewOpening, type BriefedSpec } from './brief.server';

const spec = {
  interviewer: {
    name: 'Riley', role: 'interviewing someone about a recent deal', persona: 'Curious and direct.', opening: 'Hi, I’m Riley. What did you sell?',
    orientation: ['ORIENTATION ONE', 'ORIENTATION TWO'], boundaries: ['BOUNDARY ONE'],
    voices: [{ id: 'riley-cedar', voice: 'cedar', label: 'Cedar', presentation: 'Male', image: '/riley.png' }],
  },
} satisfies BriefedSpec;

test('the brief puts the spec’s ground rules before the engine’s turn-taking, techniques and notes', () => {
  const paragraphs = interviewerBrief(spec, 'riley-cedar').split('\n\n');
  expect(paragraphs.slice(0, 4)).toEqual(['You are Riley, interviewing someone about a recent deal. Curious and direct.', 'ORIENTATION ONE', 'ORIENTATION TWO', 'BOUNDARY ONE']);
  expect(paragraphs[4]).toStartWith('Turn-taking:');
  expect(paragraphs[6]).toStartWith('The participant decides when the interview ends');
  expect(paragraphs[7]).toStartWith('Technique guide.');
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
