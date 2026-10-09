import { z } from 'zod';

const text = z.string().trim().min(1);

/** Explicit host-supplied background. It helps interpretation and never establishes participant findings. */
export const interviewContextSchema = z.object({
  background: text.max(16_000).optional(),
  participant: z.object({ name: text.max(200), background: text.max(8000).optional() }).strict().optional(),
}).strict();
export type InterviewContext = z.infer<typeof interviewContextSchema>;

export const reportFormatSchema = z.object({ audience: text.max(2000), format: text.max(16_000) }).strict();
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** Every topic uses the same shape; nesting organizes more specific things to learn. */
export type InterviewTopic = {
  id: string;
  label: string;
  learn: string;
  appliesWhen?: string;
  topics?: InterviewTopic[];
};

const id = text.max(100).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, underscores or hyphens for IDs.');
export const interviewTopicSchema: z.ZodType<InterviewTopic> = z.lazy(() => z.object({
  id, label: text.max(200), learn: text.max(4000), appliesWhen: text.max(2000).optional(),
  topics: z.array(interviewTopicSchema).min(1).optional(),
}).strict());

/** Learning intent is prose. Situation and participant background belong in InterviewContext. */
export const interviewDraftSchema = z.object({
  title: text.max(200), goals: text.max(8000), topics: z.array(interviewTopicSchema).min(1),
  guidance: text.max(8000).optional(), report: reportFormatSchema,
}).strict().superRefine((plan, ctx) => {
  const ids = new Set<string>();
  const visit = (topics: InterviewTopic[], path: (string | number)[]) => {
    topics.forEach((topic, index) => {
      if (ids.has(topic.id)) ctx.addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'Topic IDs must be unique throughout the plan.' });
      ids.add(topic.id);
      if (topic.topics) visit(topic.topics, [...path, index, 'topics']);
    });
  };
  visit(plan.topics, ['topics']);
});
export const interviewPlanSchema = interviewDraftSchema.safeExtend({ id, version: text.max(200) });
export type InterviewPlan = z.infer<typeof interviewPlanSchema>;
