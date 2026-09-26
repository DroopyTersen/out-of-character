import { expect, test } from 'bun:test';
import { loader } from './storybook';

test('workshop client diagnostics stay separate from the simulator catalog', () => {
  const { simulatorCatalog, workshopClientStats } = loader();
  expect(workshopClientStats.map(client => client.id)).toEqual(simulatorCatalog.clients.map(client => client.id));
  expect(workshopClientStats.find(client => client.id === 'morgan')?.stats).toEqual({
    assertiveness: 4, skepticism: 3, guardedness: 3, bargaining: 4, riskAversion: 3, relationship: 1,
  });
  for (const client of simulatorCatalog.clients) expect(client).not.toHaveProperty('stats');
});
