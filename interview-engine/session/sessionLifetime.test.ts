import { expect, test } from 'bun:test';
import { attemptDeadline, canHold, lifetimeDecision, pauseDeadline, resumeRefusal } from './sessionLifetime';

type Input = Parameters<typeof lifetimeDecision>[0];
const limits = { durationSeconds: 3600, idleWarningMs: 180_000, idleTimeoutMs: 300_000, pauseHoldMs: 900_000, maxResumes: 5 };
const input = (over: Partial<Input> = {}): Input => ({
  now: 0, status: 'live', startedAt: 0, reachedLive: true, lastSeen: 0, lastActivity: 0, voiceActivityAt: 0,
  deadline: 3_600_000, capacityDeadline: null, limits, ...over,
});
const pause = { reason: 'browser' as const, pausedAt: 1000, resumeBy: 901_000, resumes: 0, maxResumes: 5 };

test.each([
  [35_000, true, 'continue'], [35_001, true, 'pause'], [35_001, false, 'end'],
] as const)('contact age %i after reaching live=%s gives %s', (now, reachedLive, action) => {
  const result = lifetimeDecision(input({ now, reachedLive }));
  expect(result.action).toBe(action);
  expect(result.interrupted).toBeUndefined();
});

test.each([
  [59_999, false, 'continue', undefined], [60_000, false, 'end', true],
  [59_999, true, 'continue', undefined], [60_000, true, 'pause', undefined],
] as const)('connection age %i after reaching live=%s gives %s', (elapsed, reachedLive, action, interrupted) => {
  const now = elapsed + 1000;
  expect(lifetimeDecision(input({ now, lastSeen: now, status: 'connecting', connectingSince: 1000, reachedLive }))).toMatchObject({ action });
  expect(lifetimeDecision(input({ now, lastSeen: now, status: 'connecting', connectingSince: 1000, reachedLive })).interrupted).toBe(interrupted);
});

test('lost contact precedes connection timeout, while connecting ignores conversation warnings', () => {
  expect(lifetimeDecision(input({ now: 60_000, status: 'connecting', reachedLive: false })).interrupted).toBeUndefined();
  expect(lifetimeDecision(input({ now: 59_999, lastSeen: 59_999, status: 'connecting', deadline: 1, capacityDeadline: 1 }))).toEqual({ action: 'continue' });
});

test('paused holds expire exactly at their deadline and retain capped wording', () => {
  expect(lifetimeDecision(input({ status: 'paused', pause, now: 900_999 }))).toEqual({ action: 'continue' });
  expect(lifetimeDecision(input({ status: 'paused', pause, now: 901_000 }))).toMatchObject({ action: 'end', message: expect.stringContaining('within 15 minutes') });
  expect(lifetimeDecision(input({ status: 'paused', pause: { ...pause, resumeBy: 500_000 }, now: 500_000 }))).toMatchObject({ action: 'end', message: expect.stringContaining('in time') });
});

test('warning thresholds, clearing, earliest deadline and idle-limit-capacity tie precedence', () => {
  const read = (over: Partial<Input>) => lifetimeDecision(input({ now: 240_000, lastSeen: 240_000, ...over }));
  expect(read({ now: 179_999 }).warning).toBeNull();
  expect(read({ now: 180_000 }).warning).toEqual({ kind: 'idle', endsAt: 300_000 });
  expect(read({ lastActivity: 240_000 }).warning).toBeNull();
  expect(read({ deadline: 300_000, capacityDeadline: 300_000 }).warning).toEqual({ kind: 'idle', endsAt: 300_000 });
  expect(read({ lastActivity: 240_000, deadline: 300_000, capacityDeadline: 300_000 }).warning).toEqual({ kind: 'limit', endsAt: 300_000 });
  expect(read({ deadline: 300_000, capacityDeadline: 290_000 }).warning).toEqual({ kind: 'capacity', endsAt: 290_000 });
  expect(read({ lastActivity: 240_000, deadline: 300_001 }).warning).toBeNull();
});

test('idle ends exactly on its deadline even while voice activity is current', () => {
  expect(lifetimeDecision(input({ now: 299_999, lastSeen: 299_999, voiceActivityAt: 299_999 })).action).toBe('continue');
  expect(lifetimeDecision(input({ now: 300_000, lastSeen: 300_000, voiceActivityAt: 300_000 })).action).toBe('end');
});

test.each([
  [0, 9000, 'drain'], [2999, 9000, 'drain'], [3000, 2499, 'drain'],
  [3000, 2500, 'end'], [19_999, 0, 'drain'], [20_000, 0, 'end'],
] as const)('automatic limits at +%ims with voice age %ims give %s', (after, age, action) => {
  const now = 100_000 + after;
  for (const kind of ['limit', 'capacity'] as const) {
    const result = lifetimeDecision(input({ now, lastSeen: now, lastActivity: now, voiceActivityAt: now - age,
      ...(kind === 'limit' ? { deadline: 100_000 } : { capacityDeadline: 100_000 }),
    }));
    expect(result.action).toBe(action);
    expect(result.warning).toEqual({ kind, endsAt: 100_000 });
  }
});

test('pause time extends the deadline once, bounded by the ninety-minute wall cap', () => {
  expect(attemptDeadline(3_600_000, 0, 600_000, 900_000)).toBe(3_900_000);
  expect(attemptDeadline(3_900_000, 0, undefined, 950_000)).toBe(3_900_000);
  expect(attemptDeadline(3_900_000, 0, 1_000_000, 4_000_000)).toBe(5_400_000);
  expect(pauseDeadline(0, 600_000, 900_000)).toBe(1_500_000);
  expect(pauseDeadline(0, 5_000_000, 900_000)).toBe(5_400_000);
});

test('holding requires more than one minute, while an existing hold may resume at exactly one minute', () => {
  expect(canHold(160_001, 100_000, null)).toBe(true);
  expect(canHold(160_000, 100_000, null)).toBe(false);
  expect(canHold(200_000, 100_000, 150_000)).toBe(false);
  expect(resumeRefusal(4, 5, 200_000, 160_000, 100_000)).toBeNull();
  expect(resumeRefusal(4, 5, 200_000, 159_999, 100_000)).toContain('Too little time');
});

test('resume refusals prioritize exhausted attempts, then expired hold, then remaining time', () => {
  expect(resumeRefusal(5, 5, 100_000, 150_000, 100_000)).toContain('too many times');
  expect(resumeRefusal(4, 5, 100_000, 150_000, 100_000)).toContain('expired');
  expect(resumeRefusal(4, 5, 100_001, 150_000, 100_000)).toContain('Too little time');
});
