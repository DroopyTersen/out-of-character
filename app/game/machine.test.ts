import { expect, test } from 'bun:test';
import { createActor } from 'xstate';
import { gameMachine } from './machine';

function game(events: string[]) {
  const actor = createActor(gameMachine).start();
  for (const type of events) actor.send({ type });
  return actor;
}

test('capture readiness, rather than Start alone, begins a performance', () => {
  const actor = game(['SPIN', 'START']);
  expect(actor.getSnapshot().value).toBe('starting');
  actor.send({ type: 'READY' });
  expect(actor.getSnapshot().value).toBe('performing');
  actor.stop();
});

test('Give up freezes the terminal state against delayed success and failure', () => {
  const actor = game(['SPIN', 'START', 'READY', 'GIVE_UP']);
  for (const type of ['WIN', 'FAIL', 'READY', 'GIVE_UP', 'START']) {
    actor.send({ type });
    expect(actor.getSnapshot().value).toBe('result');
  }
  actor.send({ type: 'RESET' });
  expect(actor.getSnapshot().value).toBe('idle');
  actor.stop();
});

test('victory freezes the terminal state against late surrender and capture errors', () => {
  const actor = game(['SPIN', 'START', 'READY', 'WIN']);
  for (const type of ['GIVE_UP', 'FAIL', 'WIN']) {
    actor.send({ type });
    expect(actor.getSnapshot().value).toBe('result');
  }
  actor.stop();
});

test('canceling connection returns to preparation and ignores delayed readiness', () => {
  const actor = game(['SPIN', 'START', 'CANCEL', 'READY']);
  expect(actor.getSnapshot().value).toBe('preparing');
  actor.send({ type: 'START' });
  expect(actor.getSnapshot().value).toBe('starting');
  actor.stop();
});

test('reset during connection or performance leaves a usable idle game and ignores old events', () => {
  for (const prior of [[], ['READY']]) {
    const actor = game(['SPIN', 'START', ...prior, 'RESET', 'READY', 'WIN']);
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'SPIN' });
    expect(actor.getSnapshot().value).toBe('preparing');
    actor.stop();
  }
});

test('a connection or performance error can retry through readiness', () => {
  for (const prior of [[], ['READY']]) {
    const actor = game(['SPIN', 'START', ...prior, 'FAIL']);
    expect(actor.getSnapshot().value).toBe('interrupted');
    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('starting');
    actor.send({ type: 'READY' });
    expect(actor.getSnapshot().value).toBe('performing');
    actor.stop();
  }
});

test('duplicate and out-of-phase events cannot bypass drawing or audio setup', () => {
  const actor = game(['START', 'READY', 'WIN', 'GIVE_UP', 'RETRY']);
  expect(actor.getSnapshot().value).toBe('idle');
  actor.send({ type: 'SPIN' });
  for (const type of ['SPIN', 'READY', 'WIN', 'RETRY']) actor.send({ type });
  expect(actor.getSnapshot().value).toBe('preparing');
  actor.stop();
});
