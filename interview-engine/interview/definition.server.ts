import { z } from 'zod';
import { id, interviewContextSchema, interviewPlanSchema, text, type InterviewContext, type InterviewPlan, type InterviewTopic } from '../shared/plan';
import type { InterviewLimits } from '../shared/spec';

import type { BriefedSpec } from './voice/brief.server';
import type { JudgedSpec } from './conversation/rubric.prompt';
import type { MappedSpec } from './conversation/map.prompt';

/** Host runtime choices, separate from the organizer's approved content. */
export const interviewConfigSchema = z.object({
  interviewer: z.object({ name: text, persona: text, voices: z.array(z.object({ id, voice: text, label: text, presentation: text, image: text })).min(1)
    .refine(voices => new Set(voices.map(voice => voice.id)).size === voices.length, 'Voice IDs must be unique.') }),
  limits: (z.object({ durationSeconds: z.number().int().positive(), idleWarningMs: z.number().int().positive(), idleTimeoutMs: z.number().int().positive(), pauseHoldMs: z.number().int().nonnegative(), maxResumes: z.number().int().nonnegative() }) satisfies z.ZodType<InterviewLimits>)
    .refine(limits => limits.idleWarningMs < limits.idleTimeoutMs, 'The idle warning must precede the timeout.').optional(),
});
export type InterviewConfig = z.infer<typeof interviewConfigSchema>;
export type InterviewDefinition = { plan: InterviewPlan; config: InterviewConfig; context?: InterviewContext };

/** Engine-owned prompt parts. Hosts provide the plan and runtime configuration, not these fragments. */
export type ResolvedInterview = BriefedSpec & Omit<JudgedSpec, 'topics'> & Omit<MappedSpec, 'topics'> & {
  topics: readonly { id: string; label: string; objectives: readonly { id: string; label: string; criterion: string; appliesWhen?: string }[] }[];
  id: string; version: string; plan: InterviewPlan; config: InterviewConfig; context?: InterviewContext; limits?: InterviewConfig['limits'];
};

/** Leaves retain their identity. Parent intent and conditions remain attached to their descendants. */
function coverageTopics(topics: InterviewTopic[], parents: InterviewTopic[] = []): { id: string; label: string; criterion: string; appliesWhen?: string }[] {
  return topics.flatMap(topic => {
    if (topic.topics?.length) return coverageTopics(topic.topics, [...parents, topic]);
    const conditions = [...parents, topic].flatMap(item => item.appliesWhen ? [item.appliesWhen] : []);
    return [{ id: topic.id, label: topic.label, criterion: [topic.learn, ...(parents.length ? [`Parent learning intent (context for this topic, not additional coverage requirements): ${parents.map(parent => `${parent.label}: ${parent.learn}`).join(' / ')}`] : [])].join(' '),
      ...(conditions.length ? { appliesWhen: conditions.join('\nAND\n') } : {}),
    }];
  });
}

/** Resolve once from approved content; neither the caller nor a mutable catalog may change a running interview. */
export function resolveInterview(input: InterviewPlan, supplied: InterviewConfig, context?: InterviewContext): ResolvedInterview {
  const plan = interviewPlanSchema.parse(input);
  const config = interviewConfigSchema.parse(supplied);
  const background = context ? interviewContextSchema.parse(context) : undefined;
  const reference = background && { background: background.background, participant: background.participant };
  const voiceContext = background && { ...reference, background: background.voiceBackground ?? background.background };
  const sourceRule = 'Only the participant establishes their experience. Supplied background helps interpret names and circumstances, but it is not something the participant said or confirmed. Do not use it to infer their responsibilities, complete their account, or grant coverage. Distinguish firsthand knowledge, attributed accounts, inference and public research.';
  return {
    id: plan.id, version: plan.version, plan, config, ...(background ? { context: background } : {}), limits: config.limits,
    interviewer: {
      ...config.interviewer,
      role: 'conducting an interview with one participant',
      orientation: [
        `Interview type or purpose: ${plan.title}. This is a plan label, not the identity of a project, organization or event.`,
        `Learning goals: ${plan.goals}`,
        'First orient the participant: introduce yourself, explain the purpose and ground the subject before asking for their role or lessons. Use explicitly supplied names and circumstances; ask for missing context instead of assuming it. If they ask what the interview is about, explain plainly and clarify the missing subject rather than repeating the plan label. Discover their actual responsibilities, including multiple or changing roles. Let their experience guide the conversation. Never re-ask what they have already answered. Keep it a conversation, not a questionnaire.',
        ...(plan.guidance ? [`Approved interviewing guidance: ${plan.guidance}`] : []),
        ...(voiceContext ? [`Supplied background, not participant evidence: ${JSON.stringify(voiceContext)}`] : []),
      ],
      boundaries: [sourceRule, 'Respect uncertainty and explicit boundaries immediately. Do not press the same point in other words. A short, precise answer may be complete. Do not invent events, causes, names or outcomes, or claim shared experiences.'],
      techniques: {
        grounding: { name: 'Ground the conversation', means: 'Establish the concrete subject and relevant people or organizations, then the participant’s own part, before exploring details.', when: 'After the opening preamble or when the subject, a name or a responsibility is unclear.', how: 'One open question about the first missing piece, using supplied context and what they have already said.' },
        lesson: { name: 'Find the useful lesson', means: 'A concrete action and its consequence may already be the lesson. Follow up only on a useful missing part.', when: 'A story leaves a concrete uncertainty about what to repeat or change.', how: 'Ask one grounded question without inventing a problem or demanding a hypothetical.' },
      },
    },
    framing: {
      occasion: `an interview about ${plan.title}`, topic: 'topic', purpose: plan.goals,
      setting: [sourceRule, `Approved topic tree (parents supply learning intent; only leaves are assessed): ${JSON.stringify(plan.topics)}`, 'For conditional topics, establish relevance from the participant’s own account. Unknown relevance is not failure or not applicable. A parent condition applies to every descendant. Do not pursue a branch that does not apply.', reference ? `Supplied context: ${JSON.stringify(reference)}` : '', plan.guidance ? `Approved interviewing guidance: ${plan.guidance}` : ''].filter(Boolean).join('\n\n'),
      defaultThread: 'Ground the concrete situation relevant to the approved goals and guidance: what it was, who was involved, and the participant’s own experience. Clarify the first missing piece; a plan label is not a project or organization name. Supplied context can identify the subject, but only the participant establishes their responsibilities and vantage. This thread is a default, not a reason to interrupt a richer story.',
      terms: 'A topic is one specific thing the approved plan seeks to learn. Parent topics organize the conversation; coverage is assessed only for leaves.',
      party: sourceRule,
    },
    topics: plan.topics.map(topic => ({ id: topic.id, label: topic.label,
      objectives: coverageTopics([topic]),
    })),
  };
}
