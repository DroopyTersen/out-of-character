import type { CoverageLevel, InterviewObjectiveReading, ReadingValue } from '../../shared/snapshot';
import type { Reading } from '../../shared/spec';

/**
 * Live coverage is re-judged every grade. A current explored or set-aside reading wins;
 * otherwise a prior band holds while the current reading still gives it at least even odds,
 * so a topic neither flickers nor stays credited once the evidence stops supporting it.
 * Touched only means the topic came up, so its odds are P(it came up at all) = 1 − P(not yet):
 * mass moving toward explored without evidence does not drop it to not yet.
 * A declined topic stays closed until a supported answer reopens it; the final grade is independent.
 */
export function mergeCoverage<S extends string>(previous: InterviewObjectiveReading<S>[], current: InterviewObjectiveReading<S>[]): InterviewObjectiveReading<S>[] {
  return current.map(reading => {
    const prior = previous.find(item => item.id === reading.id);
    if (reading.applicability && (reading.applicability !== 'applicable' || prior?.applicability !== reading.applicability)) return reading;
    if (reading.level === 'explored' || reading.level === 'set-aside' || !prior || prior.level === 'not-yet' || !prior.evidence) return reading;
    // Retain the boundary and the confidence of its supporting judgment; raw new odds stay in diagnostics.
    if (prior.level === 'set-aside') return prior;
    if (!reading.levels) return reading;
    const odds = prior.level === 'touched' ? 1 - reading.levels['not-yet'] : reading.levels[prior.level];
    if (odds < .5) return reading;
    return { ...reading, level: prior.level, achieved: prior.level === 'explored', evidence: prior.evidence };
  });
}


export const COVERAGE_LEVEL_LABELS: Record<CoverageLevel, string> = { 'not-yet': 'Not yet', touched: 'Touched on', explored: 'Explored', 'set-aside': 'Set aside' };

/**
 * P(explored) for explored, P(set aside) for set aside, and P(it has come up at all)
 * for touched. The latter is not confidence in its exact depth. Not yet shows none.
 */
export function coverageConfidence(reading: Pick<InterviewObjectiveReading<string>, 'level' | 'levels'> | undefined): number | null {
  if (!reading?.levels || reading.level === 'not-yet') return null;
  return reading.level === 'touched' ? 1 - reading.levels['not-yet'] : reading.levels[reading.level];
}

/** Every reading of the spec, not yet read. */
export function emptyReadings<const R extends readonly Reading[], S extends string = string>(readings: R): Record<R[number]['id'], ReadingValue<S>> {
  return Object.fromEntries(readings.map(({ id }) => [id, { value: null, distribution: null, evidence: null }])) as Record<R[number]['id'], ReadingValue<S>>;
}
