/**
 * One thing the interview hopes to cover, judged by Jev's coverage reading. The judging text is server-only:
 * `criterion` says what covering it takes, including whose words count. A spec the browser imports leaves it out.
 */
export type Objective = { id: string; label: string; criterion?: string; appliesWhen?: string };
export type TopicGroup = { id: string; label: string; objectives: readonly Objective[] };
/** How Jev scores one reading: the question it answers and one criterion for each point of its 0–4 scale. Server-only. */
export type ReadingRubric = { task: string; criteria: readonly string[] };
/** One reading of the participant on Jev's scale (for example specificity). */
export type Reading = { id: string; label: string; description: string; rubric?: ReadingRubric };
/** `voice` is the voice provider's voice name; `image` is the host's portrait for it. */
export type Voice = { id: string; voice: string; label: string; presentation: string; image: string };
/** One numbered technique in the interviewer's guide. Without `sounds`, `how` gives the shape and the brief quotes no example lines. */
export type Technique = { name: string; means: string; when: string; how: string; sounds?: readonly string[] };
/**
 * The kind of interview, in the words Sol's map and Jev's grade use. Server-only. `occasion` completes “an AI voice
 * interviewer in …”; `topic` names one topic (“closeout topic”, pluralized with an s); `purpose` and `setting` open
 * Sol's seed; `defaultThread` is the thread Sol keeps open from the first call; `terms` defines the spec's words for
 * Jev; `party` says whose words count toward a topic.
 */
export type InterviewFraming = { occasion: string; topic: string; purpose: string; setting: string; defaultThread: string; terms: string; party: string };
export type InterviewLimits = { durationSeconds: number; idleWarningMs: number; idleTimeoutMs: number; pauseHoldMs: number; maxResumes: number };
