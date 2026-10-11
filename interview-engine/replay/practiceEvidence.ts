import type { InterviewArchiveRow } from '../seams.server';
import type { Passage } from '../shared/transcript';
import { interviewTurnGaps } from './timeline';

/** Measurements and pointers for a human assessment; no inferred compliance or acoustic interruption score. */
export function practiceEvidence(transcript: Passage[], records: InterviewArchiveRow['producerLog'], provenance?: InterviewArchiveRow['provenance']) {
  const turns = records.filter(record => record.source === 'turn');
  const notes = records.filter(record => record.source === 'note');
  const media = provenance?.media;
  const overlaps: { captureId: string; epoch: number; atMs: number; durationMs: number }[] = [];
  for (const capture of media?.captures ?? []) {
    const events = media!.events.filter(event => event.captureId === capture.captureId).sort((a, b) => a.sequence - b.sequence);
    for (let i = 0; i < events.length - 1; i++) {
      const event = events[i]!, next = events[i + 1]!;
      if (event.inputActive && event.outputActive && next.epoch === event.epoch && next.sequence === event.sequence + 1 && next.atMs >= event.atMs) {
        overlaps.push({ captureId: capture.captureId, epoch: event.epoch, atMs: event.atMs, durationMs: next.atMs - event.atMs });
      }
    }
  }
  const participantIds = new Set(transcript.filter(passage => passage.speaker === 'participant').map(passage => passage.id));
  return {
    measurements: {
      providerTranscript: transcript.length > 0,
      serverTranscriptArrival: provenance?.passageTimings?.length ?? 0,
      browserMediaEvents: media?.events.length ?? 0,
      browserDiscarded: (media?.captures ?? []).reduce((sum, capture) => sum + capture.dropped, 0),
      browserUnreceived: (media?.captures ?? []).reduce((sum, capture) => sum + Math.max(0, capture.observed - capture.received), 0),
      serverDiscarded: media?.discarded ?? 0,
      clockSamples: (media?.captures ?? []).reduce((sum, capture) => sum + capture.clocks.length, 0),
      renderedInstructions: !!provenance?.brief && !!provenance.opening,
      models: provenance?.models ?? null,
      audioRecording: 'Not contained in this archive. Practice recordings must be collected separately.',
      trace: 'Fetch the trace separately; its ID alone is not evidence of retained observations.',
    },
    choices: turns.map(turn => ({ id: turn.id, passageId: turn.passageId, mapId: turn.mapId, revision: turn.revision ?? null, next: turn.reading?.next ?? null, guidance: turn.guidance ?? null })),
    feedbackCandidates: turns.filter(turn => (turn.reading?.feedback ?? 0) >= .8).map(turn => {
      const index = transcript.findIndex(passage => passage.id === turn.passageId);
      return { turnId: turn.id, passageId: turn.passageId, nextSamPassageId: index < 0 ? null : transcript.slice(index + 1).find(passage => passage.speaker === 'interviewer')?.id ?? null };
    }),
    guidance: notes.map(note => ({ id: note.id, kind: note.kind, sentAt: note.sentAt, outcome: note.outcome, acknowledgedAt: note.delivery.acknowledgedAt ?? null, delivery: note.delivery.status, nextSamTranscriptReceivedAt: note.nextSamTurnAt ?? null })),
    research: records.filter(record => record.source === 'research').map(record => ({ id: record.id, origin: record.origin ?? null, requestedIdentity: record.request.name, matchedIdentity: record.matchedIdentity ?? null, outcome: record.outcome, reason: record.reason ?? null, sources: record.facts?.map(fact => fact.url) ?? [] })),
    coverageInconsistencies: records.flatMap(record => record.source !== 'grade' ? [] : (record.objectives ?? []).flatMap(objective => {
      const [level, evidence] = objective.graded;
      const missing = !evidence || !participantIds.has(evidence);
      return missing && (level === 'explored' || level === 'touched' || (objective.levels?.[2] ?? 0) >= .85) ? [{ gradeId: record.id, objectiveId: objective.id, level, evidence }] : [];
    })),
    providerClockLongGaps: interviewTurnGaps(transcript),
    browserClockOverlapCandidates: overlaps,
    interpretation: 'Audio activity can include noise or backchannels. Listen to practice recordings to assess interruptions. Feedback candidates are model judgments; inspect the linked passages. Note-to-next-Sam-transcript-arrival is neither audio-onset nor compliance latency. Provider, server and browser clocks are separate; browser/server estimates include round-trip uncertainty.',
  };
}
