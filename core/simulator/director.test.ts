import { expect, test } from 'bun:test';
import { ACTOR_CONDITIONS, DirectorGate, selectDirectorSignal } from './director';

const complete = async () => {};

test('audiences have independent in-flight slots; completion releases slots but retains cooldown', async () => {
  const gate = new DirectorGate();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }]);
  gate.observe('actor', [{ condition: 'role', probability: .99 }]);
  const work = gate.review('trainee', 1000, 1, () => pending);
  expect(work.decision).toBe('started');
  await gate.review('actor', 1001, 1, complete).work;
  expect(gate.review('trainee', 80_000, 4, complete).decision).toBe('busy');
  finish();
  await work.work;
  gate.observe('trainee', [{ condition: 'objective:impact', selected: true }]);
  expect(gate.review('trainee', 10_000, 2, complete).decision).toBe('cooldown');
  expect(gate.review('trainee', 21_000, 2, complete).decision).toBe('started');
});

test('objective selection noise never resets identity or reconsideration', async () => {
  const gate = new DirectorGate();
  const ids: string[] = [];
  const remember = async (issue: { id: string }) => { ids.push(issue.id); };
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }]);
  await gate.review('trainee', 1000, 1, remember).work;
  gate.observe('trainee', [{ condition: 'objective:need', selected: false }, { condition: 'objective:impact', selected: true }]);
  gate.observe('trainee', [{ condition: 'objective:need', selected: true }, { condition: 'objective:impact', selected: false }]);
  expect(gate.review('trainee', 21_000, 3, remember).decision).toBe('waiting_for_progress');
  expect(gate.review('trainee', 61_000, 1, remember).decision).toBe('waiting_for_progress');
  await gate.review('trainee', 61_000, 4, remember).work;
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

test('a concern owns the trainee slot only while it is above its alert threshold', async () => {
  const gate = new DirectorGate();
  const reviewed: string[] = [];
  const remember = async (issue: { signal: { condition: string } }) => { reviewed.push(issue.signal.condition); };
  const need = { condition: 'objective:need', selected: true } as const;
  gate.observe('trainee', [{ condition: 'mistake', probability: .88 }, need]);
  await gate.review('trainee', 1000, 1, remember).work;
  // A concern fading through the hysteresis band stays shown but no longer starves other coaching.
  gate.observe('trainee', [{ condition: 'mistake', probability: .84 }, need]);
  expect(gate.concern()?.signal.condition).toBe('mistake');
  expect(gate.urgentConcerns()).toEqual([]);
  await gate.review('trainee', 21_000, 2, remember).work;
  gate.observe('trainee', [{ condition: 'mistake', probability: .77 }, need]);
  expect(gate.review('trainee', 41_000, 3, remember).decision).toBe('waiting_for_progress');
  gate.observe('trainee', [{ condition: 'mistake', probability: .6 }, need]);
  expect(gate.concern()).toBeDefined();
  expect(reviewed).toEqual(['mistake', 'objective:need']);
});

test('an eligible concern still suppresses ordinary coaching, and disrespect outranks a material mistake', async () => {
  const gate = new DirectorGate();
  gate.observe('trainee', [{ condition: 'mistake', probability: .9 }, { condition: 'disrespect', probability: .9 }, { condition: 'objective:need', selected: true }]);
  expect(gate.concerns().map(issue => issue.signal.condition)).toEqual(['disrespect', 'mistake']);
  await gate.review('trainee', 1000, 1, async issue => { expect(issue.signal.condition).toBe('disrespect'); }).work;
  // The concern was reviewed; the eligible material mistake is next, still ahead of the objective.
  await gate.review('trainee', 21_000, 2, async issue => { expect(issue.signal.condition).toBe('mistake'); }).work;
  expect(gate.review('trainee', 41_000, 3, complete).decision).toBe('waiting_for_progress');
  expect(gate.usage.callsByAudience.trainee).toBe(2);
});

test('invalid signals cannot trigger reviews and scores are not signals', () => {
  const gate = new DirectorGate();
  gate.observe('actor', [{ condition: 'knowledge', probability: NaN }, { condition: 'authority', probability: 1.1 }, { condition: 'interests', probability: .59 }]);
  expect(gate.review('actor', 1000, 1, complete).decision).toBe('no_trigger');
  expect(gate.usage.callsByAudience).toEqual({ trainee: 0, actor: 0 });
});

test('actor concerns earn a second opinion at .60 without lowering trainee thresholds', async () => {
  for (const condition of ACTOR_CONDITIONS) {
    const gate = new DirectorGate();
    gate.observe('actor', [{ condition, probability: .59 }]);
    expect(gate.review('actor', 1000, 1, complete).decision).toBe('no_trigger');
    gate.observe('actor', [{ condition, probability: .6 }]);
    await gate.review('actor', 2000, 1, complete).work;
    expect(gate.usage.callsByAudience.actor).toBe(1);
  }
  const gate = new DirectorGate();
  gate.observe('trainee', [{ condition: 'disrespect', probability: .84 }, { condition: 'mistake', probability: .84 }, { condition: 'stalled', probability: .79 }]);
  expect(gate.review('trainee', 1000, 1, complete).decision).toBe('no_trigger');
});

test('actor referrals cannot spend the trainee budget, including when generation fails', async () => {
  const gate = new DirectorGate();
  for (let i = 0; i < 20; i++) {
    gate.observe('actor', [{ condition: 'role', probability: 0 }]);
    gate.observe('actor', [{ condition: 'role', probability: 1 }]);
    const work = gate.review('actor', i * 20_000, i, () => { throw new Error('Provider failed'); });
    expect(work.decision).toBe('started');
    await expect(work.work).rejects.toThrow('Provider failed');
  }
  expect(gate.review('actor', 500_000, 22, complete).decision).toBe('budget');
  expect(gate.hasCapacity('trainee')).toBe(true);
  for (let i = 0; i < 40; i++) {
    gate.observe('trainee', [{ condition: 'stalled', probability: 0 }]);
    gate.observe('trainee', [{ condition: 'stalled', probability: 1 }]);
    await gate.review('trainee', i * 20_000, i, complete).work;
  }
  expect(gate.review('trainee', 1_000_000, 42, complete).decision).toBe('budget');
  expect(gate.usage.callsByAudience).toEqual({ trainee: 40, actor: 20 });
});

test('the strongest actor issue is reviewed first without changing trainee concern priority', async () => {
  const signals = [{ condition: 'knowledge' as const, probability: .6 }, { condition: 'authority' as const, probability: .92 }, { condition: 'interests' as const, probability: .8 }];
  const gate = new DirectorGate();
  gate.observe('actor', signals);
  let reviewed: string | undefined;
  await gate.review('actor', 1000, 1, async issue => { reviewed = issue.signal.condition; }).work;
  expect(reviewed).toBe('authority');
  expect(selectDirectorSignal(signals, 'actor')?.condition).toBe('authority');
  expect(signals[0]?.condition).toBe('knowledge');
  gate.observe('trainee', [{ condition: 'stalled', probability: .99 }, { condition: 'mistake', probability: .86 }]);
  await gate.review('trainee', 1000, 1, async issue => { reviewed = issue.signal.condition; }).work;
  expect(reviewed).toBe('mistake');
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
  expect(gate.usage).toEqual({ callsByAudience: { trainee: 0, actor: 0 }, rechecks: 60, notes: 6 });
});
