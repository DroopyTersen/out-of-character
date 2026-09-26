import { describe, expect, test } from 'bun:test';
import { actorBrief, getClient, getScenario, publicCatalog } from '../../ai/simulator/scenarios.server';
import { appendTranscript, buildDebrief, canSendCue, reconcileObjectives, settledTranscript } from './state';
import { emptySkills, type ObjectiveReading, type TranscriptEntry } from './types';

describe('simulator boundaries', () => {
  test('public selection contains no private agenda, reaction rules, or evaluation criteria', () => {
    const catalog = publicCatalog();
    expect(catalog.scenarios).toHaveLength(2);
    expect(catalog.clients).toHaveLength(3);
    const json = JSON.stringify(catalog);
    for (const secret of ['8,000', 'took the blame', 'operations analyst', 'overdue-item history', 'seriousMistake', 'criterion', 'behavior', 'voice', 'approval-boundary']) {
      // "behavior" is a public objective kind, not the private character instructions.
      if (secret === 'behavior') expect(catalog.clients[0]).not.toHaveProperty(secret);
      else expect(json).not.toContain(secret);
    }
    expect(catalog.scenarios[0]!.objectives.map(item => item.id)).toEqual(['problem', 'impact', 'stakeholder', 'capability', 'next-step']);
  });
  test('interchangeable characters retain identical business constraints', () => {
    const scenario = getScenario('sharepoint');
    const morgan = actorBrief(scenario, getClient('morgan'));
    const avery = actorBrief(scenario, getClient('avery'));
    for (const constraint of scenario.constraints) {
      expect(morgan).toContain(constraint);
      expect(avery).toContain(constraint);
    }
    expect(morgan).not.toBe(avery);
    for (const objective of scenario.objectives) expect(morgan).not.toContain(objective.criterion);
  });
});

describe('transcript and feedback behavior', () => {
  test('preserves actual fragments and overlapping speakers', () => {
    let entries: TranscriptEntry[] = [];
    entries = appendTranscript(entries, { speaker: 'trainee', text: 'I can', startMs: 100, endMs: 600 });
    entries = appendTranscript(entries, { speaker: 'trainee', text: ' help,', startMs: 600, endMs: 900 });
    expect(entries[0]!.text).toBe('I can help,');
    entries = appendTranscript(entries, { speaker: 'client', text: ' wait.', startMs: 850, endMs: 1200 });
    entries = appendTranscript(entries, { speaker: 'trainee', text: ' after we check scope.', startMs: 950, endMs: 2000 });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.text).toBe('I can help, after we check scope.');
    expect(appendTranscript(entries, { speaker: 'client', text: 'bad', startMs: NaN, endMs: 10 })).toBe(entries);
  });
  test('a client backchannel cannot settle a trainee passage that is still growing', () => {
    const entries: TranscriptEntry[] = [
      { id: 'p1', speaker: 'trainee', text: 'What I can offer, after we check', startMs: 0, endMs: 4400 },
      { id: 'p2', speaker: 'client', text: 'Mm.', startMs: 4300, endMs: 4600 },
    ];
    const updates = new Map([['p1', 4400], ['p2', 4600]]);
    expect(settledTranscript(entries, updates, 4700)).toEqual([]);
    updates.set('p1', 5700);
    expect(settledTranscript(entries, updates, 5800).map(item => item.id)).toEqual(['p2']);
    expect(settledTranscript(entries, updates, 6900).map(item => item.id)).toEqual(['p1', 'p2']);
  });
  test('later objectives can complete first; discoveries persist and agreements can be withdrawn', () => {
    const scenario = publicCatalog().scenarios[0]!;
    const reading = (id: string, achieved: boolean): ObjectiveReading => ({ id, achieved, probability: achieved ? .99 : .01, evidence: achieved ? { entryId: 'p3', speaker: 'client', text: 'Operations owns it.' } : null });
    const first = reconcileObjectives(scenario, [], [reading('stakeholder', true), reading('next-step', true)]);
    expect(first.filter(item => item.achieved).map(item => item.id)).toEqual(['stakeholder', 'next-step']);
    const second = reconcileObjectives(scenario, first, [reading('stakeholder', false), reading('next-step', false)]);
    expect(second.filter(item => item.achieved).map(item => item.id)).toEqual(['stakeholder']);
    expect(second[2]!.evidence?.text).toBe('Operations owns it.');
  });
  test('a reply separates two trainee turns even when the gap is short', () => {
    let entries: TranscriptEntry[] = [];
    entries = appendTranscript(entries, { speaker: 'trainee', text: 'Who owns it?', startMs: 0, endMs: 900 });
    entries = appendTranscript(entries, { speaker: 'client', text: 'Dana.', startMs: 1000, endMs: 1400 });
    entries = appendTranscript(entries, { speaker: 'trainee', text: 'Let us invite Dana.', startMs: 1500, endMs: 2400 });
    expect(entries.map(entry => entry.text)).toEqual(['Who owns it?', 'Dana.', 'Let us invite Dana.']);
  });
  test('a judged passage remains exact when more speech arrives from the same speaker', () => {
    let entries: TranscriptEntry[] = [];
    entries = appendTranscript(entries, { speaker: 'client', text: 'Versions are a problem.', startMs: 0, endMs: 900 });
    const judgedText = entries[0]!.text;
    entries = appendTranscript(entries, { speaker: 'client', text: ' Actually, I was mistaken.', startMs: 1000, endMs: 1500 }, new Set(['p1']));
    expect(entries.map(entry => entry.text)).toEqual([judgedText, ' Actually, I was mistaken.']);
    expect(entries.map(entry => entry.id)).toEqual(['p1', 'p2']);
  });
  test('client cues require fresh, probable, nonrepeating evidence and a cooldown', () => {
    const cue = { id: 'earned-progress', probability: .95, revision: 7 };
    expect(canSendCue(cue, null, true, 50_000)).toBe(true);
    expect(canSendCue(cue, null, false, 50_000)).toBe(false);
    for (const p of [.6, NaN, 1.1]) expect(canSendCue({ ...cue, probability: p }, null, true, 50_000)).toBe(false);
    expect(canSendCue({ ...cue, id: 'no_hint' }, null, true, 50_000)).toBe(false);
    expect(canSendCue(cue, { id: 'approval-boundary', revision: 5, sentAt: 40_000 }, true, 50_000)).toBe(false);
    expect(canSendCue(cue, { ...cue, sentAt: 1 }, true, 50_000)).toBe(false);
  });
  test('debrief never invents performance for unobserved skills', () => {
    const scenario = publicCatalog().scenarios[0]!;
    expect(buildDebrief(scenario, null).strengths).toEqual([]);
    const readings = emptySkills();
    readings.listening = { value: 1, distribution: null, evidence: { entryId: 'p2', speaker: 'trainee', text: 'The features are what matter.' } };
    const result = buildDebrief(scenario, { revision: 2, skills: readings, objectives: [], hint: null, concern: null, model: 'fixture', durationMs: 0 });
    expect(result.strengths).toEqual([]);
    expect(result.improvements.map(item => item.skill)).toEqual(['listening']);
    expect(result.improvements[0]!.evidence.text).toBe('The features are what matter.');
  });
});
