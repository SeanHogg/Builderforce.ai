/**
 * "Read again with what we learned" (PRD 33 §5.3.3).
 *
 * A graded proof is the best input the next read of an idea can have. The plan
 * route loads the prior proof's grade and evidence, hands it to the Read step as
 * context, records it on `idea.read` (`metadata.priorGrade`, which `proofJourney`
 * uses to chain attempts), and lets {@link PRIOR_GRADE_RULES} steer the
 * recommender. The rules are DATA — a new lesson is an entry, not a branch:
 *
 *   met                       → the next proof up in fidelity;
 *   sample never reached      → the same form again, and fix the traffic first;
 *   missed on a full sample   → a cheaper form that tests the first cited pattern.
 */

import type { ProofPattern } from '@builderforce/interaction-contract';
import type { RealizationTarget } from './realizationTarget';
import { isRealizationVerdict, type RealizationVerdict, type Row } from './realizationStore';

export interface PriorGrade {
  realizationId: string;
  targetKey: string;
  verdict: RealizationVerdict | null;
  held: 'sample_not_reached' | null;
  /** Null for a console-only grade, which never measured a sample. */
  sampleReached: boolean | null;
  value: number | null;
  target: number | null;
  sampleN: number | null;
  /** The first cited pattern over the visitors who did not convert, when there was one. */
  firstPattern: string | null;
}

export type PriorGradePick = 'same' | 'lowerEffort' | 'nextFidelity';

export interface PriorGradeRule {
  id: 'met' | 'sample_not_reached' | 'missed_with_sample';
  when: (grade: PriorGrade) => boolean;
  pick: PriorGradePick;
  reason: (grade: PriorGrade) => string;
}

export const PRIOR_GRADE_RULES: readonly PriorGradeRule[] = [
  {
    id: 'met',
    when: (g) => g.verdict === 'met',
    pick: 'nextFidelity',
    reason: () => 'The last proof met its kill condition — take the next proof up in fidelity.',
  },
  {
    id: 'sample_not_reached',
    when: (g) => g.held === 'sample_not_reached' || g.sampleReached === false,
    pick: 'same',
    reason: () => 'The last proof never reached its sample — run the same form again and fix the traffic first.',
  },
  {
    id: 'missed_with_sample',
    when: (g) => g.verdict === 'missed',
    pick: 'lowerEffort',
    reason: (g) => (g.firstPattern
      ? `The last proof missed on a full sample — test "${g.firstPattern}" with a cheaper form.`
      : 'The last proof missed on a full sample — test what stopped visitors with a cheaper form.'),
  },
];

const numOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The grade a realization row carries, as the next read needs it. */
export function priorGradeFromRow(row: Pick<Row, 'id' | 'targetKey' | 'verdict' | 'verdictMetric'>): PriorGrade {
  const metric = (row.verdictMetric ?? {}) as Record<string, unknown>;
  const measured = metric.measured === true;
  const sampleN = numOrNull(metric.sample);
  const sampleMin = numOrNull(metric.sampleMin);
  const evidence = (metric.evidence ?? {}) as { patterns?: ProofPattern[] };
  const held = metric.held === 'sample_not_reached' ? 'sample_not_reached' : null;
  return {
    realizationId: row.id,
    targetKey: row.targetKey,
    verdict: isRealizationVerdict(row.verdict) ? row.verdict : null,
    held,
    sampleReached: held ? false : measured && sampleN !== null && sampleMin !== null ? sampleN >= sampleMin : null,
    value: numOrNull(metric.metricValue),
    target: numOrNull(metric.target),
    sampleN,
    firstPattern: Array.isArray(evidence.patterns) && typeof evidence.patterns[0]?.text === 'string'
      ? evidence.patterns[0].text.slice(0, 240)
      : null,
  };
}

/** The first rule the grade matches, or null (an abandoned or ungraded proof steers nothing). */
export function priorGradeRule(grade: PriorGrade): PriorGradeRule | null {
  return PRIOR_GRADE_RULES.find((rule) => rule.when(grade)) ?? null;
}

/** Resolve a pick against the catalog. Falls back to the same form when nothing fits. */
export function resolvePriorGradePick(pick: PriorGradePick, prior: RealizationTarget, targets: readonly RealizationTarget[]): RealizationTarget {
  if (pick === 'lowerEffort') {
    // Cheaper — or as cheap and a smaller claim — closest in fidelity to what was tried.
    const cheaper = targets.filter((t) => t.key !== prior.key
      && (t.effort < prior.effort || (t.effort === prior.effort && t.fidelity < prior.fidelity)));
    cheaper.sort((a, b) => b.fidelity - a.fidelity || a.effort - b.effort);
    return cheaper[0] ?? prior;
  }
  if (pick === 'nextFidelity') {
    const higher = targets.filter((t) => t.fidelity > prior.fidelity);
    higher.sort((a, b) => a.fidelity - b.fidelity || a.effort - b.effort);
    return higher[0] ?? prior;
  }
  return prior;
}

/**
 * What the Read step is told about the last attempt — appended to the idea, so the
 * spec the model extracts is read in the light of what the proof showed.
 */
export function priorGradeContext(grade: PriorGrade): string {
  const lines = [`What the last proof of this idea (${grade.targetKey}) showed:`];
  if (grade.verdict) lines.push(`- Verdict: ${grade.verdict}.`);
  if (grade.held) lines.push('- It never reached its sample, so the number was not a grade.');
  if (grade.value !== null && grade.target !== null) {
    lines.push(`- Measured ${grade.value} against a target of ${grade.target}${grade.sampleN !== null ? ` on ${grade.sampleN} visits` : ''}.`);
  }
  if (grade.firstPattern) lines.push(`- Visitors who did not convert: ${grade.firstPattern}`);
  return lines.join('\n');
}

/** `idea.read` metadata — small on purpose, the ledger has a ceiling. */
export function priorGradeMetadata(grade: PriorGrade, ruleId: string | null): Record<string, unknown> {
  return {
    realizationId: grade.realizationId,
    targetKey: grade.targetKey,
    verdict: grade.verdict,
    held: grade.held,
    sampleReached: grade.sampleReached,
    rule: ruleId,
  };
}
