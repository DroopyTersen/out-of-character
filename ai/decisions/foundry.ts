import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { render, singletons, type Fetch, type Model, type Request, type Result } from '../../interview-engine/providers/decisionJudge.server';
import { latestTurn } from '../../interview-engine/interview/conversation/ranking.server';

export type FoundryFormat = 'literal' | 'readable' | 'dialogue' | 'task-last' | 'evidence' | 'evidence-compact' | 'context' | 'scoped' | 'clarified' | 'precise' | 'topic' | 'satisfied' | 'satisfied-short' | 'accounts' | 'human' | 'synthetic-1' | 'synthetic-2' | 'synthetic-3' | 'synthetic-4';

const syntheticPolicies: Partial<Record<FoundryFormat, { base: FoundryFormat; policy: string; objective?: string; evidenceOnly?: boolean }>> = {
  'synthetic-1': { base: 'human', policy: 'Coverage is judged against the stated topic criterion, not whether the interviewer asked every useful follow-up. A concrete coordination difficulty, division of work, or constraint can answer a topic that asks what happened, even if the outcome is unresolved. A participant can provide a complete concise fact inside a longer unfinished story. Preserve any explicit requirement for a consequence, suggestion, or particular party; merely naming a role or a topic does not satisfy such a requirement.' },
  'synthetic-2': { base: 'human', policy: 'Evaluate each factual claim separately. A participant can supply a concrete firsthand fact or explicitly attributed account while marking a different fact unknown. Preserve the established account; do not extend either its facts or its uncertainty to other claims. An account of which staff actually covered which work describes a workload allocation, while naming an absent role alone describes no effect. For coordination, an actual division-of-work dispute or dependency is an account of coordination even without a final resolution. The specified party must still be established: product behavior and client operations alone do not establish internal delivery-team practices.' },
  'synthetic-3': { base: 'human', objective: 'process-tools', policy: 'This topic concerns HOW THE DELIVERY TEAM WORKED. Establish the team practice or tool and its practical effect from participant speech. A feature, technical component, or operational workflow built FOR USERS does not satisfy it, even if developers implemented that feature. For example, a search box in the delivered website is a product feature; an issue board the team used to assign defects is an internal tool. Credit the latter only when the participant also establishes its practical effect. Do not infer internal tool use from technical implementation details.' },
  'synthetic-4': { base: 'human', evidenceOnly: true, policy: 'Select participant evidence for the actual coverage level, not only for full credit. A relevant but incomplete concrete statement supports touched; a statement that satisfies the topic criterion supports explored; a refusal or stated knowledge limit about this topic supports set-aside. Choose none only when this batch contains no relevant participant statement or only an interviewer premise or bare acknowledgment. Selecting relevant evidence never upgrades incomplete coverage or establishes an unstated fact. Preserve the topic-specific party and requirements.' },
};

/** A second Microsoft pass checks a candidate quotation; it can still reject it or select different evidence. */
export function anchoredRequest(request: Request, answers: Result['answers']): Request {
  const base = foundryRequest(request, 'topic');
  const state = request.state;
  const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
  if (!Array.isArray(dialogue)) return base;
  const participant = new Map(dialogue.filter(row => Array.isArray(row) && row.length === 3 && row[1] === 'participant').map(([id, , text]) => [id, text]));
  return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
    if (!id.startsWith('objective:') || id.slice('objective:'.length).includes(':') || !question.instructions || typeof question.instructions !== 'object') return [id, question];
    const candidates = Object.entries(answers).filter(([key, answer]) => key.startsWith(`${id}:evidence`) && answer.type === 'choice' && participant.has(answer.choice))
      .map(([, answer]) => answer as Extract<Result['answers'][string], { type: 'choice' }>).sort((a, b) => (b.probabilities?.[b.choice] ?? 0) - (a.probabilities?.[a.choice] ?? 0));
    const selected = candidates[0];
    if (!selected) return [id, question];
    return [id, { ...question, instructions: { ...question.instructions,
      candidateParticipantPassage: { id: selected.choice, speaker: 'participant', text: String(participant.get(selected.choice)).slice(0, 512) },
      candidatePolicy: 'This quotation was selected by a first model pass; it is a candidate, not an established answer. Check it against the exact topic criterion and full dialogue. Reject it if it does not support the criterion. Keep unknown details separate from concrete facts the participant did supply.',
    } }];
  })) };
}

/** Presentation experiments retain instructions, choices, passage IDs and speakers. */
export function foundryRequest(request: Request, format: FoundryFormat): Request {
  if (format === 'literal') return request;
  const synthetic = syntheticPolicies[format];
  if (synthetic) {
    if (!Object.keys(request.questions).some(id => id.startsWith('objective:'))) return foundryRequest(request, request.questions.feedback ? 'precise' : 'literal');
    const base = foundryRequest(request, synthetic.base);
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      if (question.type !== 'choice' || !id.startsWith('objective:')) return [id, question];
      if (synthetic.evidenceOnly ? !id.includes(':evidence') || id.includes(':applicability') : id.slice('objective:'.length).includes(':')) return [id, question];
      if (synthetic.objective && id !== `objective:${synthetic.objective}`) return [id, question];
      return [id, { ...question, instructions: `${render(question.instructions, 'readable')}\ncoveragePolicy: ${synthetic.policy}` }];
    })) };
  }
  if (format === 'human') {
    const base = foundryRequest(request, 'topic');
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      const instructions = render(question.instructions, 'readable');
      if (question.type !== 'choice') return [id, { ...question, instructions }];
      return [id, { ...question, instructions,
        criteria: Object.fromEntries(Object.entries(question.criteria).map(([key, criterion]) => [key, criterion == null ? null : render(criterion, 'readable')])),
      }];
    })) };
  }
  if (format === 'accounts') {
    const base = foundryRequest(request, 'topic');
    const state = request.state;
    const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
    if (!Array.isArray(dialogue) || !dialogue.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string'))) return base;
    const passages = dialogue.map(([id, speaker, text]) => ({ id, speaker, text }));
    return { ...base, state: { participantSpeech: passages.filter(passage => passage.speaker === 'participant'),
      interviewerContext: passages.filter(passage => passage.speaker !== 'participant'),
      order: passages.map(passage => passage.id) } };
  }
  if (format === 'satisfied-short') {
    const base = foundryRequest(request, 'satisfied');
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      if (!id.endsWith(':satisfied') || !question.instructions || typeof question.instructions !== 'object' || !('task' in question.instructions)) return [id, question];
      const instructions = question.instructions;
      return [id, { ...question, instructions: Object.fromEntries(Object.entries(instructions).filter(([key]) => ['task', 'party', 'sourceRule'].includes(key))) }];
    })) };
  }
  if (format === 'satisfied') {
    const base = foundryRequest(request, 'topic');
    const questions = { ...base.questions };
    for (const [id, question] of Object.entries(request.questions)) {
      if (!id.startsWith('objective:') || id.slice('objective:'.length).includes(':') || question.type !== 'choice'
        || !question.instructions || typeof question.instructions !== 'object' || !('task' in question.instructions)) continue;
      questions[`${id}:satisfied`] = { type: 'boolean', instructions: { ...question.instructions,
        task: `Do the participant's own statements satisfy this topic criterion? ${question.instructions.task}`,
      }, criteria: {
        true: { criterion: question.criteria.explored, requirement: 'The participant supplies their own concrete facts answering the stated topic criterion for the specified party. A concise fact or attributed account can suffice.' },
        false: 'The criterion is not answered: absent, merely mentioned, unfinished, unknown, declined, or established only by the interviewer. Product features alone do not establish delivery-team practices; delivery-team decisions alone do not establish client decisions.',
      } };
    }
    return { ...base, questions };
  }
  if (format === 'topic') {
    const base = foundryRequest(request, 'precise');
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      const instructions = request.questions[id]!.instructions;
      if (!id.startsWith('objective:') || id.slice('objective:'.length).includes(':') || question.type !== 'choice'
        || !instructions || typeof instructions !== 'object' || !('task' in instructions)) return [id, question];
      return [id, { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).map(([key, criterion]) => [key,
        criterion && typeof criterion === 'object' && 'meaning' in criterion ? { topic: instructions.task, meaning: criterion.meaning } : criterion,
      ])) }];
    })) };
  }
  if (format === 'precise') {
    const base = foundryRequest(request, 'clarified');
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      if (id === 'feedback' && question.instructions && typeof question.instructions === 'object' && !Array.isArray(question.instructions)) return [id, { ...question, instructions: { ...question.instructions,
        task: 'Does the latest participant turn express a preference, complaint, correction or request about the INTERVIEWER\'S questioning or conduct that is missing from savedPreferences? Compare with savedPreferences, not with earlier dialogue. A proposed better question is feedback about the interview even if phrased as a hypothetical. Saying the interviewer already covered a subject requests avoiding repetition. Discussing project users\' feedback or a client\'s request for a document is not interview feedback. Treat a preference as saved only when its meaning is already captured.',
      } }];
      if (id.startsWith('state:') && question.type === 'choice') return [id, { ...question, criteria: { ...question.criteria,
        open: 'This gap remains unresolved: the latest turn is unrelated, still mid-sentence or mid-story, asks for clarification or repetition, corrects a premise, or requests a better phrasing without refusing the subject. A refusal to revisit an already-covered subject is declined instead.',
        answered: 'The participant FINISHES an answer that supplies what this gap says is still unknown. A mid-sentence or mid-story start is open even if some related facts were mentioned. Interview feedback alone does not answer the gap.',
        declined: 'The participant refuses or rules out THIS gap\'s subject, including saying they already covered it or asking to move on. This also declines adjacent versions of that same subject, even when phrased as feedback about repetitive questions. It never declines unrelated subjects. Merely correcting, narrowing or requesting repetition of a question keeps it open.',
      } }];
      if (id.startsWith('objective:') && !id.slice('objective:'.length).includes(':') && question.type === 'choice') {
        return [id, { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).map(([key, meaning]) => [key, { topic: request.questions[id]!.instructions, meaning }])) }];
      }
      return [id, question];
    })) };
  }
  if (format === 'clarified') {
    const base = foundryRequest(request, request.questions.feedback ? 'scoped' : 'evidence-compact');
    return { ...base, questions: Object.fromEntries(Object.entries(base.questions).map(([id, question]) => {
      if (question.type !== 'choice') return [id, question];
      if (id.startsWith('state:')) return [id, { ...question, criteria: {
        open: 'This gap remains open: the latest participant turn is unrelated, unfinished, asks for clarification or repetition, corrects a premise, or gives feedback about how the interviewer asks questions. A request to rephrase a question does not itself refuse its subject.',
        answered: 'The latest participant turn supplies the answer to what this gap says is still unknown. Interview feedback alone does not answer a project gap.',
        declined: 'The latest participant turn refuses or rules out THIS gap\'s subject: cannot answer it, it does not apply, already covered it, or wants to leave this subject. A general move-on declines only the preceding interviewer question\'s subject and adjacent versions, not unrelated gaps. Correcting or narrowing a question is not refusing the subject.',
        stalled: 'The preceding interviewer question directly asks THIS gap, and the participant FINISHES an answer but supplies no answer to the unknown because it is vague, evasive or off-point. An unfinished thought, clarification, correction, request to repeat or rephrase, or interview feedback is OPEN instead.',
      } }];
      if (!id.startsWith('objective:') || id.slice('objective:'.length).includes(':') || !('explored' in question.criteria)) return [id, question];
      return [id, { ...question, criteria: { ...question.criteria,
        'not-yet': 'No participant statement addresses this topic criterion. An interviewer question, suggestion or example alone does not establish it.',
        touched: 'The participant begins or mentions the topic, but their own statements do not yet satisfy the stated criterion.',
        explored: { criterion: question.criteria.explored, depth: 'The stated criterion is answered by the participant\'s own concrete facts. A concise fact or explicitly attributed account can suffice. Unknown motives or a qualifier about an unrelated detail do not erase the supplied facts.' },
        'set-aside': 'The participant cannot or will not address THIS topic itself, or says it does not apply. Uncertainty about one detail, a hearsay qualifier, or a boundary on another topic is insufficient to set this topic aside when the participant also supplies relevant facts.',
      } }];
    })) };
  }
  if (format === 'context' || format === 'scoped') {
    const state = request.state;
    const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
    if (!Array.isArray(dialogue) || !dialogue.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string'))) return request;
    const passages = dialogue.map(([id, speaker, text]) => ({ id, speaker, text }));
    const turn = request.questions.feedback;
    if (turn?.instructions && typeof turn.instructions === 'object' && !Array.isArray(turn.instructions) && 'latest' in turn.instructions && Array.isArray(turn.instructions.latest)) {
      const ids = new Set(latestTurn(passages.map(passage => ({ ...passage,
        speaker: passage.speaker === 'participant' ? 'participant' as const : 'interviewer' as const,
        startMs: 0, endMs: 0,
      }))).map(passage => passage.id));
      const last = passages.filter(passage => ids.has(passage.id));
      const earlier = passages.filter(passage => !ids.has(passage.id));
      const context = format === 'scoped' ? earlier.slice(-8) : earlier;
      return { ...request, state: { earlierDialogue: context, latestParticipantTurn: last,
        precedingInterviewer: passages.slice(0, passages.findIndex(passage => ids.has(passage.id))).findLast(passage => passage.speaker !== 'participant') ?? null,
        earlierDialogueOmitted: context.length !== earlier.length } };
    }
    const supported = foundryRequest(request, 'evidence-compact');
    return { ...supported, state: { dialogue: passages }, questions: Object.fromEntries(Object.entries(supported.questions).map(([id, question]) => {
      if (format !== 'scoped' || !id.startsWith('objective:') || id.includes(':evidence') || question.type !== 'choice'
        || typeof question.instructions !== 'object' || !question.instructions || Array.isArray(question.instructions) || !('task' in question.instructions) || typeof question.instructions.task !== 'string') return [id, question];
      const topic = question.instructions.task;
      return [id, { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).map(([key, criterion]) => [key, {
        topic, meaning: criterion,
      }])) }];
    })) };
  }
  if (format === 'evidence' || format === 'evidence-compact') {
    const state = request.state;
    const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
    if (!Array.isArray(dialogue)) return request;
    const passages = new Map(dialogue.filter(row => Array.isArray(row) && row.length === 3 && row[1] === 'participant'
      && typeof row[0] === 'string' && typeof row[2] === 'string').map(row => [row[0], row[2] as string]));
    return { ...request, questions: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
      if (question.type !== 'choice' || !id.includes(':evidence')) return [id, question];
      const criteria = Object.fromEntries(Object.entries(question.criteria).map(([key, criterion]) => {
        if (criterion != null || !passages.has(key)) return [key, criterion];
        const excerpt = JSON.stringify(passages.get(key)!.slice(0, format === 'evidence-compact' ? 32 : 96));
        return [key, format === 'evidence-compact' ? excerpt : `Participant passage ${key} begins: ${excerpt}. Full text remains in dialogue.`];
      }));
      return [id, { ...question, criteria }];
    })) };
  }
  if (format === 'dialogue') {
    const state = request.state;
    const dialogue = typeof state === 'object' && state !== null && 'dialogue' in state ? state.dialogue : null;
    return Array.isArray(dialogue) && Object.keys(state).length === 2
      && dialogue.every(row => Array.isArray(row) && row.length === 3 && row.every(value => typeof value === 'string'))
      ? { ...request, state: dialogue.map(row => `[${JSON.stringify(row[0])}] ${row[1]}: ${JSON.stringify(row[2])}`).join('\n') }
      : request;
  }
  return { ...request, questions: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    let instructions = question.instructions;
    if (format === 'task-last' && instructions && typeof instructions === 'object' && !Array.isArray(instructions) && 'task' in instructions) {
      instructions = Object.fromEntries([...Object.entries(instructions).filter(([key]) => key !== 'task'), ['task', instructions.task]]);
    }
    return [id, { ...question, instructions: render(instructions, 'readable') }];
  })) };
}

/** Foundry exposes the same System One payload; only the endpoint and authentication differ. */
export function foundryModel(options: { apiKey: string; baseURL: string; model: string; fetch?: Fetch }): Model {
  const request = options.fetch ?? fetch;
  const authenticatedFetch: Fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('Authorization');
    headers.set('api-key', options.apiKey);
    return request(url, { ...init, headers });
  };
  const model = createTypeSafeAi({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: authenticatedFetch as typeof fetch,
  }).evaluationModel(options.model);
  return singletons({ specificationVersion: model.specificationVersion, provider: model.provider, modelId: model.modelId,
    supportedQuestionTypes: model.supportedQuestionTypes, doEvaluate: request => model.doEvaluate(request) });
}
