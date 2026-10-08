import { expect, test } from 'bun:test';
import { foundryProvider } from '../providers/foundry.server';
import { testFoundry } from '../providers/testFoundry.server';
import { draftDebrief } from './draft.server';
import { vendorReview } from './setup.test';

/** One completed Responses API answer whose text is `text`. */
const answered = (text: string, requests: { body: Record<string, any> }[]) => (async (_url: string | URL | Request, init?: RequestInit) => {
  requests.push({ body: JSON.parse(String(init?.body)) });
  return Response.json({
    id: 'resp-1', status: 'completed', model: testFoundry.agentModel,
    output: [{ type: 'message', id: 'msg-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  });
}) as typeof fetch;

test('a description becomes a draft the organizer can edit, and the model sees the description as data', async () => {
  const requests: { body: Record<string, any> }[] = [];
  const model = foundryProvider(testFoundry, answered(JSON.stringify(vendorReview), requests)).responses(testFoundry.agentModel);
  const result = await draftDebrief({ description: 'A quarterly review of the vendor relationship Priya managed.', interviewer: { name: 'Sam' }, model });
  expect(result.draft).toEqual(vendorReview);
  expect(result.model).toBe(testFoundry.agentModel);
  expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  expect(requests).toHaveLength(1);
  const { body } = requests[0]!;
  const system = body.input.find((item: { role: string }) => item.role === 'developer').content as string;
  expect(system).toContain('You are Sam');
  expect(system).toContain('future opportunities');
  expect(system).toContain('untrusted data');
  expect(body.input.find((item: { role: string }) => item.role === 'user').content[0].text).toBe(JSON.stringify({ description: 'A quarterly review of the vendor relationship Priya managed.' }));
  expect(body.text?.format?.type).toBe('json_schema');
});

test('an answer that is not a usable draft is an error, not a debrief', async () => {
  const model = foundryProvider(testFoundry, answered(JSON.stringify({ ...vendorReview, topics: [] }), [])).responses(testFoundry.agentModel);
  await expect(draftDebrief({ description: 'A quarterly review of a vendor relationship.', interviewer: { name: 'Sam' }, model })).rejects.toThrow();
});
