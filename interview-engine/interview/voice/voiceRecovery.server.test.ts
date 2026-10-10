import { expect, test } from 'bun:test';
import type { VoiceInput } from '../../providers/voice.server';
import type { Passage } from '../../shared/transcript';
import { VoiceRecovery, type SilenceJudgment } from './voiceRecovery.server';
import type { RecoveryOutput, VoiceConversation, VoiceSegment } from './voiceSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const result = { probability: .95, model: 'fixture', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
function fixture(judge: SilenceJudgment = async () => result) {
  let now = 1000, active = true;
  const segments: VoiceSegment[] = [];
  const conversation: VoiceConversation = { status: 'live', transcript: [], revision: 0, composing: false };
  const sent: VoiceInput[] = [], output: RecoveryOutput[] = [], calls: Parameters<SilenceJudgment>[0][] = [];
  const recovery = new VoiceRecovery({
    now: () => now, current: () => active ? { segment: segments.at(-1)!, conversation } : null, segments: () => segments,
    silenceContinue: .8, judgeSilence: input => { calls.push(input); return judge(input); },
    send: input => { sent.push(input); return true; }, output: event => output.push(event),
  });
  const segment = () => {
    const epoch = segments.length + 1;
    const next: VoiceSegment = { epoch, providerId: `voice-${epoch}`, offsetMs: 0, startedAt: now, endedAt: null, closeReason: null, finalization: 'pending', usageSeconds: null };
    segments.push(next); recovery.greet(`greeting-${epoch}`, 'Begin the interview.'); return next;
  };
  segment();
  const say = (speaker: Passage['speaker']) => {
    const passage: Passage = { id: `p${conversation.revision + 1}`, speaker, text: speaker === 'interviewer' ? 'What did you build?' : 'A routing service.', startMs: now, endMs: now + 1 };
    conversation.transcript = [...conversation.transcript, passage]; conversation.revision++;
    recovery.transcript(passage, now);
  };
  const ready = () => { say('interviewer'); say('participant'); sent.length = 0; output.length = 0; };
  return { recovery, conversation, segments, segment, sent, output, calls, say, ready,
    at: (value: number) => { now = value; }, fence: () => { active = false; } };
}

test('receipts do not count as speech: retry once, replace once, then report unresponsive', async () => {
  const f = fixture();
  f.recovery.providerEvent(f.segments[0]!, { type: 'acknowledged', id: 'greeting-1' });
  f.at(11_000); await f.recovery.tick(11_000); await f.recovery.tick(12_000);
  expect(f.sent.map(input => input.id)).toEqual(['greeting-1', 'greeting-1-again']);
  expect(f.segments[0]!.greeting!.repliedAt).toBeNull();
  f.at(26_000); await f.recovery.tick(26_000); await f.recovery.tick(27_000);
  expect(f.output).toEqual([{ type: 'replace', epoch: 1 }]);
  f.segment(); f.at(51_000); await f.recovery.tick(51_000); await f.recovery.tick(52_000);
  expect(f.output).toEqual([{ type: 'replace', epoch: 1 }, { type: 'unresponsive', epoch: 2 }]);
});

test('audio delays greeting recovery while real interviewer speech completes it', async () => {
  const f = fixture();
  f.at(10_000); f.recovery.playback(10_000); await f.recovery.tick(11_000);
  expect(f.sent).toHaveLength(1);
  f.say('interviewer'); await f.recovery.tick(40_000);
  expect(f.output).toEqual([{ type: 'responded', epoch: 1 }]);
  expect(f.sent).toHaveLength(1);
});

test('four seconds of transcript inactivity triggers one check per revision, independent of playback', async () => {
  const pending = deferred<typeof result>(); const f = fixture(() => pending.promise); f.ready();
  await f.recovery.checkSilence(4999); expect(f.calls).toHaveLength(0);
  const check = f.recovery.checkSilence(5000);
  f.recovery.playback(6000); pending.resolve(result); await check;
  expect(f.sent).toHaveLength(1);
  expect(f.segments[0]!.silence![0]!.outcome).toBe('sent');
  await f.recovery.checkSilence(10_000); expect(f.calls).toHaveLength(1);
});

for (const speaker of ['participant', 'interviewer'] as const) test(`${speaker} transcript invalidates a pending silence judgment`, async () => {
  const pending = deferred<typeof result>(); const f = fixture(() => pending.promise); f.ready();
  const check = f.recovery.checkSilence(5000); f.at(5500); f.say(speaker);
  expect(f.calls[0]!.signal.aborted).toBe(true);
  pending.resolve(result); await check;
  expect(f.sent).toEqual([]); expect(f.segments[0]!.silence![0]!.outcome).toBe('aborted');
});

test('composing cancels a pending check and release starts a new inactivity interval', async () => {
  const pending = deferred<typeof result>(); const f = fixture(() => pending.promise); f.ready();
  const check = f.recovery.checkSilence(5000);
  f.conversation.composing = true; f.recovery.composing(true, 5500); pending.resolve(result); await check;
  await f.recovery.checkSilence(9000); expect(f.calls).toHaveLength(1); expect(f.sent).toEqual([]);
  f.conversation.composing = false; f.recovery.composing(false, 10_000);
  await f.recovery.checkSilence(13_999); expect(f.calls).toHaveLength(1);
  await f.recovery.checkSilence(14_000); expect(f.calls).toHaveLength(2); expect(f.sent).toHaveLength(1);
});

for (const change of ['fence', 'replace', 'pause', 'end'] as const) test(`${change} prevents a late continuation`, async () => {
  const pending = deferred<typeof result>(); const f = fixture(() => pending.promise); f.ready();
  const check = f.recovery.checkSilence(5000);
  if (change === 'fence') f.fence();
  if (change === 'replace') f.segment();
  if (change === 'pause') f.conversation.status = 'paused';
  if (change === 'end') f.conversation.status = 'ending';
  f.sent.length = 0; pending.resolve(result); await check;
  expect(f.sent).toEqual([]); expect(f.segments[0]!.silence![0]!.outcome).toBe('stale');
});

test('the silence budget is shared across replacement segments', async () => {
  const f = fixture(async () => ({ ...result, probability: .1 })); f.ready();
  for (let i = 0; i < 120; i++) {
    const at = 5000 + i * 5000; f.at(at - 4000); f.say('participant');
    await f.recovery.checkSilence(at);
  }
  expect(f.calls).toHaveLength(120);
  f.segment(); f.ready(); await f.recovery.checkSilence(700_000);
  expect(f.calls).toHaveLength(120);
  expect(f.sent).toEqual([]);
});

test('an expired silence judgment cannot send a continuation', async () => {
  const f = fixture(async ({ signal }) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return result;
  });
  f.ready(); await f.recovery.checkSilence(5000);
  expect(f.sent).toEqual([]); expect(f.segments[0]!.silence![0]!.outcome).toBe('timeout');
});
