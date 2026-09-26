import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { characters } from '../../core/characters';
import { characterGrounding } from '../../core/character-grounding';
import { characterQuestions, validateReadings } from '../judging';
import { fixtures } from './fixtures';

test('curated names and full backstories survive conversion verbatim', () => {
  const source = readFileSync(new URL('../../docs/consultancy-party-game-characters.md', import.meta.url), 'utf8');
  const curated = [...source.matchAll(/^\d+\. \*\*(.*?)\*\* — (.*)$/gm)].map((match) => ({ name: match[1]!, backstory: match[2]! }));
  expect(curated).toHaveLength(42);
  const converted: { name: string; backstory: string }[] = characters.map(({ name, backstory }) => ({ name, backstory }));
  expect(converted).toEqual(curated);
  expect(new Set(characters.map(({ id }) => id)).size).toBe(42);
});

test('every active character is judged in both modes without a target input', () => {
  for (const mode of ['noul', 'score'] as const) {
    const questions = characterQuestions(mode);
    expect(Object.keys(questions).sort()).toEqual(characters.map(({ id }) => id).sort());
    for (const character of characters) {
      expect(JSON.stringify(questions[character.id])).toContain(character.backstory);
      expect(questions[character.id]!.instructions).toMatchObject({ grounding: characterGrounding[character.id] });
    }
  }
});

test('readings must cover exactly the cast with finite probabilities', () => {
  const valid = Object.fromEntries(characters.map(({ id }) => [id, .8]));
  expect(() => validateReadings(valid)).not.toThrow();
  const first = characters[0].id;
  const missing = { ...valid };
  delete missing[first];
  expect(() => validateReadings(missing)).toThrow();
  expect(() => validateReadings({ ...missing, invented: .8 })).toThrow();
  for (const value of [NaN, Infinity, -.01, 1.01]) {
    expect(() => validateReadings({ ...valid, [first]: value })).toThrow();
  }
});

test('fixed development and holdout sets contain valid target IDs and negative cases', () => {
  expect(fixtures.filter(({ split }) => split === 'development')).toHaveLength(11);
  expect(fixtures.filter(({ split }) => split === 'holdout')).toHaveLength(6);
  for (const fixture of fixtures) {
    if (fixture.expected) expect(characters.some(({ id }) => id === fixture.expected)).toBe(true);
  }
  expect(fixtures.filter(({ expected }) => !expected).length).toBe(6);
});
