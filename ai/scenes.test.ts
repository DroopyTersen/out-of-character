import { expect, test } from 'bun:test';
import { validScene } from './scenes';

test('scene accepts a short invitation to perform without requiring a question or dilemma', () => {
  expect(validScene('A new teammate asks what makes your spreadsheet special. Give them a quick guided tour.')).toBe(true);
  expect(validScene('An intern asks for a tour of your spreadsheet.')).toBe(true);
  expect(validScene('Walk the team through your architecture diagram.')).toBe(true);
});

test('scene enforces a 15-word maximum with no minimum and no more than two plain sentences', () => {
  const valid = 'A new teammate asks what makes your spreadsheet special. Give them a quick guided tour.';
  expect(validScene('Introduce your intern.')).toBe(true);
  expect(validScene('A new teammate asks what makes your spreadsheet so special. Give them a quick guided tour.')).toBe(false);
  expect(validScene('A teammate notices your spreadsheet. They ask for a tour. Show them around.')).toBe(false);
  expect(validScene(`${valid}\nA heading`)).toBe(false);
  expect(validScene(`# ${valid}`)).toBe(false);
  expect(validScene(`**${valid}**`)).toBe(false);
  expect(validScene('A new teammate asks what makes your spreadsheet special. Give them a quick guided tour')).toBe(false);
  expect(validScene('')).toBe(false);
});

test('scene rejects the reported overlong problem-solving setup', () => {
  expect(validScene('The launch manager discovers the “covered” support role belongs to someone unavailable every Thursday, hours before a customer escalation review. Operations wants to postpone the review; sales wants a substitute named immediately—do you assign a qualified owner, expose the staffing gap, or risk improvising again?')).toBe(false);
});
