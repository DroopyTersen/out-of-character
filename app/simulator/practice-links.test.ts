import { expect, test } from 'bun:test';
import { publicCatalog } from '../../ai/simulator/scenarios.server';
import { parsePracticeLink, practicePath } from './practice-links';

const catalog = publicCatalog();

test('ordinary visits and unrelated query parameters keep normal selection', () => {
  for (const query of ['', 'utm_source=team']) {
    expect(parsePracticeLink(new URLSearchParams(query), catalog)).toEqual({ initial: null, invalidLink: false });
  }
});

test('a share link preserves a specific pair without extra context', () => {
  expect(practicePath('scope', 'morgan')).toBe('/simulator?scenario=scope&client=morgan');
  expect(parsePracticeLink(new URLSearchParams('scenario=scope&client=morgan&utm_source=team'), catalog)).toEqual({
    initial: { scenarioId: 'scope', clientId: 'morgan' }, invalidLink: false,
  });
  expect(parsePracticeLink(new URLSearchParams('client=quinn&scenario=happy-hour'), catalog)).toEqual({
    initial: { scenarioId: 'happy-hour', clientId: 'quinn' }, invalidLink: false,
  });
});

test('incomplete and unknown links never seed a different practice', () => {
  for (const query of ['scenario=scope', 'client=morgan', 'scenario=&client=morgan', 'scenario=scope&client=', 'scenario=missing&client=morgan', 'scenario=scope&client=missing', 'scenario=Scope&client=Morgan']) {
    expect(parsePracticeLink(new URLSearchParams(query), catalog)).toEqual({ initial: null, invalidLink: true });
  }
});
