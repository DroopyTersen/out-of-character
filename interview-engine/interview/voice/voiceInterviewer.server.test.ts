import { expect, test } from 'bun:test';
import type { VoiceConnection, VoiceEvent, VoiceHandlers, VoiceProvider } from '../../providers/voice.server';
import { testTechniques } from '../reasoning/testSpec';
import { VoiceInterviewer, type VoiceOutput } from './voiceInterviewer.server';
import type { VoiceConversation } from './voiceSession';

const spec = { interviewer: {
  name: 'Sam', role: 'asking about the work', persona: 'Curious.', orientation: [], boundaries: [], techniques: testTechniques,
  voices: [{ id: 'sam', voice: 'cedar', label: 'Cedar', presentation: 'Male' as const, image: '/sam.png' }],
} };
const tail: VoiceEvent = { type: 'transcript', id: 'last', speaker: 'participant', text: 'The handoff mattered most.', startMs: 10, endMs: 20 };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(overrides: Partial<VoiceProvider> = {}, persist?: () => Promise<void>) {
  const handlers = new Map<string, VoiceHandlers>();
  const closed: string[] = [], detached: string[] = [], output: VoiceOutput[] = [], saved: string[][] = [];
  let sequence = 0;
  const conversation: VoiceConversation = { status: 'live', transcript: [], revision: 0, composing: false };
  const voice = new VoiceInterviewer({
    spec, now: () => 1000, conversation: () => conversation, admit: () => {},
    judgeSilence: async () => { throw new Error('No silence judgment expected.'); }, silenceContinue: .8,
    persist: async () => { if (persist) await persist(); saved.push(voice.outstanding()); }, output: event => output.push(event),
    // Only the network provider is substituted; lease ordering and event routing run in the real module.
    provider: {
      create: async () => ({ id: `voice-${++sequence}`, sdp: 'answer' }),
      attach: async (id, events) => {
        handlers.set(id, events!);
        return { connected: true, send: () => true, detach: () => { detached.push(id); }, close: async () => {
          closed.push(id); events!.event(tail); events!.event({ type: 'closed', reason: 'ended', usageSeconds: 17 });
        } };
      },
      close: async (id, events) => { closed.push(id); events?.event(tail); }, ...overrides,
    },
  });
  return { voice, handlers, closed, detached, output, saved, conversation, open: () => voice.open({ voiceId: 'sam', sdp: 'offer' }) };
}

test('provider attachment waits for durable registration, and failed registration closes the new session', async () => {
  const registered = deferred<void>();
  const f = fixture({}, () => registered.promise);
  const opening = f.open();
  await Promise.resolve(); await Promise.resolve();
  expect(f.voice.outstanding()).toEqual(['voice-1']);
  expect(f.handlers.size).toBe(0);
  registered.resolve();
  expect(await opening).toEqual({ sdp: 'answer' });
  expect(f.saved).toEqual([['voice-1']]);
  expect(f.handlers.size).toBe(1);
  const failed = fixture({}, async () => { throw new Error('lease rejected'); });
  await expect(failed.open()).rejects.toThrow('lease rejected');
  expect(failed.closed).toEqual(['voice-1']);
  expect(failed.handlers.size).toBe(0);
});

test('an attachment that completes after fencing is detached without closing the successor’s session', async () => {
  const attaching = deferred<VoiceConnection>(), started = deferred<void>();
  let detached = false, closed = false;
  const f = fixture({ attach: async () => { started.resolve(); return attaching.promise; } });
  const opening = f.open();
  await started.promise;
  f.voice.detach();
  attaching.resolve({ connected: true, send: () => true, detach: () => { detached = true; }, close: async () => { closed = true; } });
  await expect(opening).rejects.toThrow('detached');
  expect(detached).toBe(true);
  expect(closed).toBe(false);
  expect(f.closed).toEqual([]);
});

test('old segments can settle usage but cannot deliver transcript into the new segment', async () => {
  const f = fixture(); await f.open(); await f.voice.closeCurrent(); await f.open();
  f.output.length = 0;
  f.handlers.get('voice-1')!.event(tail);
  expect(f.output).toEqual([]);
  f.handlers.get('voice-1')!.event({ type: 'closed', reason: 'ended', usageSeconds: 23 });
  expect(f.voice.usageSeconds()).toBe(23);
  expect(f.voice.current!.providerId).toBe('voice-2');
  expect(f.voice.current!.finalization).toBe('pending');
  expect(f.output).toMatchObject([{ type: 'event', segment: { providerId: 'voice-1' }, event: { type: 'closed' } }]);
});

test('closure delivers participant tail and usage before the final required save', async () => {
  const f = fixture(); await f.open(); f.conversation.status = 'ending';
  await f.voice.closeCurrent();
  expect(f.output).toMatchObject([{ type: 'event', event: tail }, { type: 'event', event: { type: 'closed' } }]);
  expect(f.saved).toEqual([['voice-1'], []]);
  expect(f.voice.usageSeconds()).toBe(17);
  expect(f.detached).toEqual(['voice-1']);
});

test('restored closure retries preserve outstanding IDs until provider confirmation', async () => {
  let unavailable = true;
  const f = fixture({ close: async () => { if (unavailable) throw new Error('offline'); } });
  f.voice.restore({ segments: [], providerIds: ['orphan'], epoch: 0, savedAt: 500 });
  f.voice.disconnected(1000);
  await f.voice.retryClosures();
  expect(f.voice.outstanding()).toEqual(['orphan']);
  unavailable = false;
  await f.voice.retryClosures();
  expect(f.voice.outstanding()).toEqual([]);
  expect(f.saved).toEqual([['orphan'], []]);
});
