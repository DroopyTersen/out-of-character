import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import Simulator, { loader } from './simulator';

test('a disabled simulator still serves the shared intro without an enabled start', async () => {
  const handler = createStaticHandler([{ id: 'simulator', path: '/simulator', loader, Component: Simulator }]);
  const context = await handler.query(new Request('https://practice.example/simulator?scenario=scope&client=quinn'), {
    requestContext: { cloudflare: { env: { SIMULATOR_ENABLED: 'false', PAID_SERVICES_ENABLED: 'true', OPENAI_API_KEY: 'unused-test-key', TYPESAFE_API_KEY: 'unused-test-key' } } },
  });
  if (context instanceof Response) throw new Error(`Unexpected response ${context.status}`);
  expect(context.loaderData.simulator.initial).toEqual({ scenarioId: 'scope', clientId: 'quinn' });
  expect(context.loaderData.simulator.enabled).toBe(false);
  const html = renderToStaticMarkup(createElement(StaticRouterProvider, {
    router: createStaticRouter(handler.dataRoutes, context), context,
  }));
  expect(html).toContain('Before you meet Quinn');
  expect(html).toContain('/simulator/briefings/scope.mp3');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start meeting/);
  expect(html).toContain('Live practice is currently unavailable.');
});
