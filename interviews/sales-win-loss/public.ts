// The sales win/loss interview's browser-safe content; spec.ts assembles it with the server-only brief, framing, criteria and narrative prompt.
// A second, independent spec: it shares no content with project-closeout and depends on nothing in the host.

export const SALES_WIN_LOSS_ID = 'sales-win-loss';
export const SALES_WIN_LOSS_VERSION = 'sales-win-loss-v1';
export const salesInterviewerName = 'Sam';
export const salesVoices = [
  { id: 'sam-meridian', voice: 'meridian', label: 'Meridian', presentation: 'Male', image: '/interview/sam-male.png' },
] as const;

export const salesReadings = [
  { id: 'candor', label: 'Candor', description: 'Giving the real reasons behind the decision, including the uncomfortable ones.' },
  { id: 'specificity', label: 'Specificity', description: 'Naming the moments, comparisons and criteria that actually moved the decision.' },
  { id: 'perspective', label: 'Perspective', description: 'Describing how others in the buying group saw it, not only your own view.' },
] as const;
export type SalesReadingId = typeof salesReadings[number]['id'];

export const salesTopics = [
  { id: 'need', label: 'Why you were buying', objectives: [
    { id: 'need-trigger', label: 'What started the search' },
    { id: 'need-goals', label: 'Goals & how success was measured' },
    { id: 'need-timing', label: 'Timing & urgency' },
  ] },
  { id: 'evaluation', label: 'How you chose', objectives: [
    { id: 'evaluation-options', label: 'Options on the shortlist' },
    { id: 'evaluation-criteria', label: 'Criteria & how they were weighted' },
    { id: 'evaluation-process', label: 'Steps, approvals & procurement' },
    { id: 'evaluation-people', label: 'Who weighed in & who decided' },
    { id: 'evaluation-deciding', label: 'The deciding factors' },
  ] },
  { id: 'vendor', label: 'How the vendor came across', objectives: [
    { id: 'vendor-team', label: 'Sales team & responsiveness' },
    { id: 'vendor-fit', label: 'Product fit & proof' },
    { id: 'vendor-commercial', label: 'Pricing & terms' },
    { id: 'vendor-risk', label: 'Confidence & perceived risk' },
    { id: 'vendor-outcome', label: 'What would have changed the outcome' },
  ] },
] as const;

/** A buyer debrief should not stretch an executive's calendar: half an hour, with a shorter pause hold than an internal interview. */
export const salesLimits = {
  durationSeconds: 30 * 60,
  idleWarningMs: 2 * 60_000,
  idleTimeoutMs: 4 * 60_000,
  pauseHoldMs: 10 * 60_000,
  maxResumes: 3,
} as const;
