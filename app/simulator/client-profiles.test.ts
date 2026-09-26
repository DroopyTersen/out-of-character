import { expect, test } from 'bun:test';
import { clients, scenarios } from '../../ai/simulator/scenarios.server';
import { isLiveVoice } from '../../core/simulator/voices';
import { clientProfiles } from './client-profiles';

test('every live character has a public profile and a supported default voice for open conversation', () => {
  expect(scenarios.some(scenario => scenario.id === 'happy-hour' && scenario.objectives.length === 0)).toBe(true);
  expect(Object.keys(clientProfiles).sort()).toEqual(clients.map(client => client.id).sort());
  for (const client of clients) {
    expect(isLiveVoice(client.voice)).toBe(true);
    expect(clientProfiles[client.id]!.background.length).toBeGreaterThan(20);
    expect(clientProfiles[client.id]!.traits.length).toBeGreaterThan(1);
  }
});
