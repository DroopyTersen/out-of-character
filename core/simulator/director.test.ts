import { expect, test } from 'bun:test';
import { DirectorGate } from './director';

const complete = async () => {};

test('audiences have independent in-flight slots; completion releases slots but retains cooldown', async () => {
  const gate = new DirectorGate();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }]);
  gate.observe('actor', [{ condition: 'role', probability: .99 }]);
  const work = gate.review('trainee', 1000, 2, 1, () => pending);
  expect(work).toBeDefined();
  await gate.review('actor', 1001, 2, 1, complete);
  expect(gate.review('trainee', 80_000, 4, 4, complete)).toBeUndefined();
  finish();
  await work;
  gate.observe('trainee', [{ condition: 'objective:impact', selected: true }]);
  expect(gate.review('trainee', 10_000, 3, 2, complete)).toBeUndefined();
  expect(gate.review('trainee', 21_000, 3, 2, complete)).toBeDefined();
});

test('objective selection noise never resets identity or reconsideration', async () => {
  const gate = new DirectorGate();
  const ids: string[] = [];
  const remember = async (issue: { id: string }) => { ids.push(issue.id); };
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }]);
  await gate.review('trainee', 1000, 2, 1, remember);
  gate.observe('trainee', [{ condition: 'objective:need', selected: false }, { condition: 'objective:impact', selected: true }]);
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }, { condition: 'objective:impact', selected: false }]);
  expect(gate.review('trainee', 21_000, 4, 3, remember)).toBeUndefined();
  expect(gate.review('trainee', 61_000, 3, 4, remember)).toBeUndefined();
  await gate.review('trainee', 61_000, 4, 4, remember);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test('concerns clear below .50 and have new identity only after resolution', () => {
  const gate = new DirectorGate();
  gate.observe('trainee', [{ condition: 'mistake', probability: .9 }]);
  const first = gate.concern()!.id;
  gate.observe('trainee', [{ condition: 'mistake', probability: .6 }]);
  expect(gate.concern()?.id).toBe(first);
  gate.observe('trainee', [{ condition: 'mistake', probability: .49 }]);
  expect(gate.concern()).toBeUndefined();
  gate.observe('trainee', [{ condition: 'mistake', probability: .84 }]);
  expect(gate.concern()).toBeUndefined();
  gate.observe('trainee', [{ condition: 'mistake', probability: .86 }]);
  expect(gate.concern()?.id).not.toBe(first);
});

test('a latched concern blocks ordinary coaching throughout the hysteresis band', async () => {
  const gate = new DirectorGate();
  gate.observe('trainee', [{ condition: 'mistake', probability: .9 }]);
  gate.observe('trainee', [{ condition: 'mistake', probability: .7 }, { condition: 'objective:need', selected: true }]);
  expect(gate.review('trainee', 1000, 2, 1, complete)).toBeUndefined();
  expect(gate.usage.calls).toBe(0);
  gate.observe('trainee', [{ condition: 'mistake', probability: .9 }, { condition: 'objective:need', selected: true }]);
  await gate.review('trainee', 2000, 3, 2, async issue => { expect(issue.signal.condition).toBe('mistake'); });
  expect(gate.usage.calls).toBe(1);
});

test('invalid signals cannot trigger reviews and scores are not signals', () => {
  const gate = new DirectorGate();
  gate.observe('actor', [{ condition: 'knowledge', probability: NaN }, { condition: 'authority', probability: 1.1 }, { condition: 'interests', probability: .59 }]);
  expect(gate.review('actor', 1000, 2, 1, complete)).toBeUndefined();
  expect(gate.usage.calls).toBe(0);
});

test('actor concerns earn a second opinion at .60 without lowering trainee thresholds', async () => {
  for (const condition of ['knowledge', 'authority', 'role', 'interests'] as const) {
    const gate = new DirectorGate();
    gate.observe('actor', [{ condition, probability: .59 }]);
    expect(gate.review('actor', 1000, 2, 1, complete)).toBeUndefined();
    gate.observe('actor', [{ condition, probability: .6 }]);
    await gate.review('actor', 2000, 2, 1, complete);
    expect(gate.usage.calls).toBe(1);
  }
  const gate = new DirectorGate();
  gate.observe('trainee', [{ condition: 'mistake', probability: .84 }, { condition: 'stalled', probability: .79 }]);
  expect(gate.review('trainee', 1000, 2, 1, complete)).toBeUndefined();
});

test('shared budget includes failed requests, and failures release the audience slot', async () => {
  const gate = new DirectorGate();
  for (let i = 0; i < 60; i++) {
    gate.observe('trainee', [{ condition: 'stalled', probability: 0 }]);
    gate.observe('trainee', [{ condition: 'stalled', probability: 1 }]);
    const work = gate.review('trainee', i * 20_000, i, i, () => { throw new Error('Provider failed'); });
    expect(work).toBeDefined();
    await expect(work).rejects.toThrow('Provider failed');
  }
  gate.observe('actor', [{ condition: 'role', probability: 1 }]);
  expect(gate.review('actor', 2_000_000, 60, 61, complete)).toBeUndefined();
  expect(gate.usage.calls).toBe(60);
});

test('recheck and submission caps prevent execution beyond their budgets', async () => {
  const gate = new DirectorGate();
  let checks = 0, sends = 0;
  for (let i = 0; i < 62; i++) await gate.recheck(async () => { checks++; });
  expect(checks).toBe(60);
  expect(gate.sendNote(() => false)).toBe(false);
  for (let i = 0; i < 8; i++) gate.sendNote(() => { sends++; return true; });
  expect(sends).toBe(6);
  expect(gate.hasCapacity('actor')).toBe(false);
  expect(gate.hasCapacity('trainee')).toBe(true);
  expect(gate.usage).toEqual({ calls: 0, rechecks: 60, notes: 6 });
});
