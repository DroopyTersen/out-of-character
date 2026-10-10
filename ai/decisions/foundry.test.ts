import { expect, test } from 'bun:test';
import { experimental_evaluate as evaluate } from 'ai';
import { anchoredRequest, foundryModel, foundryRequest } from './foundry';

const baseURL = 'https://example.services.ai.azure.com/providers/microsoft/v1';
const options = { apiKey: 'fixture-key', baseURL, model: 'Decision-1' };

test('evidence descriptions use only real participant excerpts and leave coverage and interviewer options unchanged', () => {
  const request = { state: { dialogue: [['p1', 'sam', 'We used Jira, right?'], ['p2', 'participant', 'We tracked the release checklist in a spreadsheet.']] },
    questions: {
      'objective:tools': { type: 'choice' as const, instructions: 'Was a process tool established?', criteria: { explored: 'Participant evidence', 'not-yet': 'No evidence' } },
      'objective:tools:evidence': { type: 'choice' as const, instructions: 'Select participant evidence', criteria: { none: 'No evidence', p1: null, p2: null } },
    } };
  const result = foundryRequest(request, 'evidence');
  expect(result.questions['objective:tools']).toEqual(request.questions['objective:tools']);
  expect(result.questions['objective:tools:evidence']).toMatchObject({ criteria: { none: 'No evidence', p1: null,
    p2: 'Participant passage p2 begins: "We tracked the release checklist in a spreadsheet.". Full text remains in dialogue.' } });
  expect(result.state).toEqual(request.state);
  expect(request.questions['objective:tools:evidence'].criteria.p2).toBeNull();
  expect(foundryRequest(request, 'evidence-compact').questions['objective:tools:evidence']).toMatchObject({ criteria: {
    none: 'No evidence', p1: null, p2: '"We tracked the release checklist"',
  } });
  expect(typeof foundryModel(options).provider).toBe('string');
});

test('presentation variants retain the rubric and preserve quoted dialogue and role IDs', () => {
  const instructions = { task: 'Did the participant explain the outage?', sourceRule: 'Use participant evidence only.', limits: ['No inferred details', 'A concise fact can suffice'] };
  const request = { state: { dialogueColumns: ['id', 'speaker', 'text'], dialogue: [['p1', 'sam', 'What failed?'], ['p2', 'participant', 'The "export" endpoint timed out.']] },
    questions: { explained: { type: 'boolean' as const, instructions, criteria: { true: 'They supplied a concrete cause', false: 'Only an interviewer premise' } } } };
  const readable = foundryRequest(request, 'readable');
  const taskLast = foundryRequest(request, 'task-last');
  expect(readable.questions.explained).toEqual({ ...request.questions.explained, instructions: 'task: Did the participant explain the outage?\nsourceRule: Use participant evidence only.\nlimits: No inferred details\nA concise fact can suffice' });
  expect(taskLast.questions.explained).toEqual({ ...request.questions.explained, instructions: 'sourceRule: Use participant evidence only.\nlimits: No inferred details\nA concise fact can suffice\ntask: Did the participant explain the outage?' });
  expect(foundryRequest(request, 'dialogue').state).toBe('["p1"] sam: "What failed?"\n["p2"] participant: "The \\"export\\" endpoint timed out."');
  expect(foundryRequest(request, 'dialogue').questions).toEqual(request.questions);
  expect(request.questions.explained.instructions).toEqual(instructions);
});

test('Foundry uses Azure authentication and preserves structured questions and evidence', async () => {
  let wire: { url: string; headers: Headers; body: unknown } | undefined;
  const state = { dialogue: [['p1', 'participant', 'Exports fail; invoices still work.']] };
  const result = await evaluate({
    model: foundryModel({ ...options, fetch: async (url, init) => {
      wire = { url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return Response.json({ model: 'Microsoft-Decision-1', usage: { input_tokens: 120, output_tokens: 3 }, answers: {
        urgent: { type: 'noul', noul: .2 },
        team: { type: 'choice', choice: 'technical', probabilities: { billing: .1, technical: .9 }, confidence: .8 },
        priority: { type: 'score', score: 1.4, probabilities: { '0': .1, '1': .4, '2': .5 }, legend: { '0': 'Low', '1': 'Medium', '2': 'High' }, confidence: .3 },
      } });
    } }),
    state,
    questions: {
      urgent: { type: 'boolean', instructions: { question: 'Does this require immediate help?' }, criteria: { true: 'Time sensitive', false: 'Routine' } },
      team: { type: 'choice', instructions: 'Which team can fix the issue?', criteria: { billing: 'Invoices', technical: 'Software failures' } },
      priority: { type: 'score', instructions: 'Priority', criteria: ['Low', 'Medium', 'High'] },
    },
    maxRetries: 0,
  });
  expect(wire?.url).toBe(`${baseURL}/systemone`);
  expect(wire?.headers.get('api-key')).toBe('fixture-key');
  expect(wire?.headers.has('Authorization')).toBe(false);
  expect(wire?.body).toEqual({ model: 'Decision-1', state, questions: {
    urgent: { type: 'noul', instructions: { question: 'Does this require immediate help?' }, criteria: { true: 'Time sensitive', false: 'Routine' } },
    team: { type: 'choice', instructions: 'Which team can fix the issue?', criteria: { billing: 'Invoices', technical: 'Software failures' } },
    priority: { type: 'score', instructions: 'Priority', criteria: ['Low', 'Medium', 'High'] },
  } });
  expect(result.answers.urgent).toEqual({ type: 'boolean', probability: .2 });
  expect(result.answers.team).toMatchObject({ choice: 'technical', probabilities: { billing: .1, technical: .9 } });
  expect(result.answers.priority).toMatchObject({ score: 1.4 });
  expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 3 });
  expect(result.response.modelId).toBe('Microsoft-Decision-1');
});

test('Foundry cannot credit an answer outside the supplied choices', async () => {
  const model = foundryModel({ ...options, fetch: async () => Response.json({ answers: {
    team: { type: 'choice', choice: 'sales', probabilities: { billing: .1, technical: .9 } },
  } }) });
  await expect(evaluate({ model, state: 'Exports fail.', questions: {
    team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Invoices', technical: 'Software' } },
  }, maxRetries: 0 })).rejects.toThrow();
});

test('Foundry failures remain failed evaluations', async () => {
  const model = foundryModel({ ...options, fetch: async () => Response.json({ error: { message: 'Overloaded' } }, { status: 503 }) });
  await expect(evaluate({ model, state: 'Exports fail.', questions: {
    urgent: { type: 'boolean', instructions: 'Urgent?' },
  }, maxRetries: 0 })).rejects.toThrow();
});

test('turn context groups resumed participant speech across interviewer backchannels', () => {
  const request = { state: { dialogue: [
    ['p1', 'sam', 'What changed in the build?'], ['p2', 'participant', 'We added tracing'],
    ['p3', 'sam', 'Mm-hmm.'], ['p4', 'participant', 'and linked feedback to the trace.'],
  ] }, questions: { feedback: { type: 'boolean' as const, instructions: {
    task: 'Any new interview feedback?', latest: [{ text: 'We added tracing' }, { text: 'and linked feedback to the trace.' }], savedPreferences: [],
  } } } };
  const result = foundryRequest(request, 'context');
  expect(result.state).toMatchObject({
    latestParticipantTurn: [{ id: 'p2', speaker: 'participant', text: 'We added tracing' }, { id: 'p4', speaker: 'participant', text: 'and linked feedback to the trace.' }],
    precedingInterviewer: { id: 'p1', speaker: 'sam', text: 'What changed in the build?' },
    earlierDialogue: [{ id: 'p1' }, { id: 'p3' }], earlierDialogueOmitted: false,
  });
  expect(result.questions).toEqual(request.questions);
});

test('experimental topic wording keeps the criterion, participant evidence IDs and source rules', () => {
  const request = { state: { dialogue: [['p1', 'sam', 'Who approved it?'], ['p2', 'participant', 'The client delegated decisions to us.']] }, questions: {
    'objective:decisions': { type: 'choice' as const, instructions: { task: 'Did the participant establish how the client engaged in decisions?', sourceRule: 'Use participant facts only.' },
      criteria: { 'not-yet': 'Absent', touched: 'Incomplete', explored: 'Client decision or explicit delegation established', 'set-aside': 'Cannot answer' } },
    'objective:decisions:evidence': { type: 'choice' as const, instructions: 'Choose participant evidence', criteria: { none: 'No evidence', p2: null } },
  } };
  const result = foundryRequest(request, 'clarified');
  expect(result.state).toEqual(request.state);
  expect(result.questions['objective:decisions']!.instructions).toEqual(request.questions['objective:decisions'].instructions);
  expect(Object.keys((result.questions['objective:decisions'] as { criteria: object }).criteria)).toEqual(['not-yet', 'touched', 'explored', 'set-aside']);
  expect((result.questions['objective:decisions'] as { criteria: object }).criteria).toMatchObject({ explored: { criterion: 'Client decision or explicit delegation established' } });
  expect(Object.keys((result.questions['objective:decisions:evidence'] as { criteria: object }).criteria)).toEqual(['none', 'p2']);
  expect(request.questions['objective:decisions'].criteria.explored).toBe('Client decision or explicit delegation established');
});

test('candidate anchors quote only the selected participant passage and never carry a first-pass coverage label', () => {
  const request = { state: { dialogue: [['p1', 'sam', 'We used Jira, right?'], ['p2', 'participant', 'No. We used a spreadsheet for releases.']] }, questions: {
    'objective:tools': { type: 'choice' as const, instructions: { task: 'Did the participant establish a delivery tool?', sourceRule: 'Participant evidence only' },
      criteria: { explored: 'Tool established', 'not-yet': 'Absent' } },
    'objective:tools:evidence': { type: 'choice' as const, instructions: 'Select evidence', criteria: { none: 'No evidence', p2: null } },
  } };
  const participant = anchoredRequest(request, { 'objective:tools:evidence': { type: 'choice', choice: 'p2', probabilities: { p2: .9, none: .1 } },
    'objective:tools': { type: 'choice', choice: 'not-yet', probabilities: { 'not-yet': .9, explored: .1 } } });
  expect(participant.state).toEqual(request.state);
  expect(participant.questions['objective:tools']?.instructions).toMatchObject({ candidateParticipantPassage: {
    id: 'p2', speaker: 'participant', text: 'No. We used a spreadsheet for releases.',
  } });
  expect(JSON.stringify(participant.questions['objective:tools']?.instructions)).not.toContain('probabilities');
  const interviewer = anchoredRequest(request, { 'objective:tools:evidence': { type: 'choice', choice: 'p1', probabilities: { p1: 1 } } });
  expect(interviewer.questions['objective:tools']?.instructions).toEqual(request.questions['objective:tools'].instructions);
});

test('synthetic grading experiments retain the transcript, evidence choices and reading rubric', () => {
  const request = { state: { dialogue: [['p1', 'sam', 'How did the team work?'], ['p2', 'participant', 'Our issue board showed who owned each defect.']] }, questions: {
    'objective:process-tools': { type: 'choice' as const, instructions: { task: 'Establish a delivery-team tool and its practical effect.', sourceRule: 'Participant facts only.' },
      criteria: { 'not-yet': 'Absent', touched: 'Incomplete', explored: 'Criterion answered', 'set-aside': 'Declined' } },
    'objective:process-tools:evidence': { type: 'choice' as const, instructions: 'Choose participant evidence', criteria: { none: 'No evidence', p2: null } },
    'reading:engagement': { type: 'score' as const, instructions: 'Observed engagement', criteria: ['Low', 'High'] },
  } };
  for (const format of ['synthetic-1', 'synthetic-2', 'synthetic-3', 'synthetic-4'] as const) {
    const result = foundryRequest(request, format);
    expect(result.state).toEqual(request.state);
    expect(Object.keys(result.questions)).toEqual(['objective:process-tools', 'objective:process-tools:evidence', 'reading:engagement']);
    expect(Object.keys((result.questions['objective:process-tools:evidence'] as { criteria: object }).criteria)).toEqual(['none', 'p2']);
    expect(result.questions['reading:engagement']).toEqual(request.questions['reading:engagement']);
  }
  expect(request.questions['objective:process-tools:evidence'].criteria.p2).toBeNull();
});
