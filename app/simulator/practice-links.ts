import type { Catalog } from '../../core/simulator/types';

export function parsePracticeLink(params: URLSearchParams, catalog: Catalog) {
  const scenarioId = params.get('scenario');
  const clientId = params.get('client');
  const valid = catalog.scenarios.some(item => item.id === scenarioId) && catalog.clients.some(item => item.id === clientId);
  return {
    initial: valid ? { scenarioId: scenarioId!, clientId: clientId! } : null,
    invalidLink: !valid && (params.has('scenario') || params.has('client')),
  };
}

export function practicePath(scenarioId: string, clientId: string) {
  return `/simulator?${new URLSearchParams({ scenario: scenarioId, client: clientId })}`;
}
