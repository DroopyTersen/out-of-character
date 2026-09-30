import { expect, test } from 'bun:test';
import { generateScene, validScene } from './scenes';
import { fixtureFoundry } from './foundry-fixture';
import { characters } from '../core/characters';

test('scene generation uses the configured Foundry Luna deployment and keeps credentials out of the prompt', async () => {
  const scene = 'Walk the team through your architecture diagram.';
  // Substitute the paid HTTP boundary; the provider and scene validation are real.
  const result = await generateScene({ characterId: characters[0]!.id, history: [], foundry: { ...fixtureFoundry, fastModel: 'scene-deployment' } }, (async (url, options) => {
    expect(String(url).split('?')[0]).toBe('https://fixture-foundry.openai.azure.com/openai/v1/responses');
    expect(new Headers(options?.headers).get('api-key')).toBe('fixture-secret');
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: 'scene-deployment', store: false, reasoning: { effort: 'low' } });
    expect(JSON.stringify(body)).not.toContain('fixture-secret');
    return Response.json({ id: 'scene-response', created_at: 1, model: 'scene-deployment', output: [
      { type: 'message', id: 'message-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: scene, annotations: [] }] },
    ], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
  }) as typeof fetch);
  expect(result).toBe(scene);
});

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
