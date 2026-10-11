import type { InterviewSnapshot } from '../shared/snapshot';
import type { ResolvedInterview } from '../definition.server';
import type { ProducerLogRecord, ProducerSummary } from '../reasoning/conversationRecords';
import { INTERVIEW_RUBRIC_VERSION } from '../judging/topicCoverage.prompt';
import type { InterviewArchiveRow } from '../seams.server';
import { interviewerBrief, interviewOpening } from '../voice/interviewerBrief.server';
import type { VoiceSegment } from '../voice/voiceSession';
import type { PauseRecord } from './sessionCheckpoint';

/** Captures one moment before hashing: later transcript, diagnostic and connection changes cannot alter the record. */
export async function captureArchiveRecord({ spec, snapshot, state, capturedAt, producerLog, producer, segments, pauses }: {
  spec: ResolvedInterview;
  snapshot: InterviewSnapshot;
  state: InterviewArchiveRow['state'];
  capturedAt: number;
  producerLog: readonly ProducerLogRecord[];
  producer: ProducerSummary | null;
  segments: readonly VoiceSegment[];
  pauses: readonly PauseRecord[];
}): Promise<InterviewArchiveRow> {
  const captured = structuredClone({
    id: snapshot.id, specId: spec.id, specVersion: spec.version, voiceId: snapshot.voiceId, state, capturedAt, snapshot,
    transcript: snapshot.transcript, producerLog: [...producerLog],
    provenance: {
      voice: spec.interviewer.voices.find(voice => voice.id === snapshot.voiceId)!.voice,
      rubricVersion: INTERVIEW_RUBRIC_VERSION, producer,
      connection: {
        segments: segments.map(({ providerId: _private, ...segment }) => segment),
        pauses: pauses.map(pause => ({ reason: pause.reason, pausedAt: pause.pausedAt, resumedAt: pause.resumedAt, durationMs: (pause.resumedAt ?? pause.endedAt ?? capturedAt) - pause.pausedAt })),
      },
    },
  });
  const [actorDigest, openingDigest] = await Promise.all([
    digest(interviewerBrief(spec, snapshot.voiceId)), digest(interviewOpening(spec, snapshot.voiceId)),
  ]);
  return { ...captured, provenance: { ...captured.provenance, actorDigest, openingDigest } };
}

async function digest(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
