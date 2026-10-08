import type { NarrativeTemplate } from '../shared/spec';
import type { Passage } from '../shared/transcript';
import type { NarrativeFailure, NarrativeUsage } from '../shared/narrative';

export type { NarrativeFailure, NarrativeUsage } from '../shared/narrative';

/** The written document: Markdown prose, as the spec's narrative schema returns it. */
export type NarrativeDocument = { text: string };
export type Narrative =
  | { document: NarrativeDocument; failure: null; usage: NarrativeUsage }
  | { document: null; failure: NarrativeFailure; usage: NarrativeUsage | null };
/** One writing attempt: text as it is written, and how it ended. `result` settles once, after or alongside the stream. */
export type NarrativeRun = { stream: ReadableStream<string>; result: Promise<Narrative> };
/** What the narrative is written from: the spec's template and the finished transcript. */
export type NarrativeInput = { template: Pick<NarrativeTemplate<NarrativeDocument>, 'system' | 'schema'>; passages: Passage[] };

export type NarrativeState = { starts: number } & (
  | { status: 'idle' | 'running'; document: null; failure: null }
  | { status: 'completed'; document: NarrativeDocument; failure: null }
  | { status: 'failed'; document: null; failure: NarrativeFailure }
);
