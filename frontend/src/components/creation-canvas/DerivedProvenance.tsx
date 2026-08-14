/**
 * The provenance line under a derived number, and the gate badge beside a score.
 *
 * ── WHY THESE TWO LIVE IN ONE FILE ───────────────────────────────────────────────
 * They answer the same question in the same place: CAN I TRUST THIS NUMBER? One says
 * what it was computed from, the other says whether it cleared the bar someone set.
 * Both are rendered by several bodies (`kpi`, `chart`, `table`, `evaluation`,
 * `model`), and both were previously rendered by NONE.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────────
 * `MAX_MATERIALIZED_ROWS` is 500, so a real file is cut on import and every chart,
 * KPI and metric downstream is computed on the cut frame. `TabularQueryResult` carried
 * `truncated` and `totalRows` and NOTHING RENDERED THEM — a KPI reading 4.2 looked
 * identical whether it summarised 500 rows or five million. That is the
 * `emptyShellProblem()` defect moved from cards to numbers, and it is worse there: a
 * quietly blank card asks a question, a quietly wrong number answers one.
 *
 * Shared component, not a prop-drilled boolean: each one decides its own visibility
 * and returns null when there is nothing worth saying — a caveat printed on every card
 * is a caveat nobody reads.
 *
 * No `'use client'`: `CreationNode` is the only caller and it already declares the
 * boundary. The directive here was a second marker for a component no server tree can
 * reach, and it put the client-file ratchet over its baseline.
 */

import { useTranslations } from 'next-intl';
import { basisNotice, type RowBasis } from '@/lib/canvasDatasetVersion';
import { evaluateGate, type EvaluationGateInput } from '@/lib/canvasEvaluationGate';
import styles from './CreationCanvas.module.css';

/** Read a `basis` field off arbitrary node data without trusting its shape. */
function readBasis(value: unknown): RowBasis | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.basisRows !== 'number' || typeof record.sourceRows !== 'number') return null;
  return {
    basisRows: record.basisRows,
    sourceRows: record.sourceRows,
    truncated: record.truncated === true,
    ...(typeof record.datasetHash === 'string' ? { datasetHash: record.datasetHash } : {}),
    ...(typeof record.datasetVersion === 'number' ? { datasetVersion: record.datasetVersion } : {}),
  };
}

/**
 * "Computed from 500 of 5,000,000 rows", or nothing.
 *
 * `currentHash` lets a card ALSO report that its source moved since it was built.
 * Truncation wins when both apply, because a number computed from a twentieth of the
 * data is a more serious caveat than one computed from data that has since changed.
 */
export function BasisNotice({ basis, currentHash }: { basis: unknown; currentHash?: string | null }) {
  const t = useTranslations('creationCanvas.basis');
  const notice = basisNotice(readBasis(basis), currentHash);
  if (!notice) return null;
  return (
    <p className={styles.basisNotice} data-testid={`basis-${notice.key}`}>
      {t(notice.key, notice.values)}
    </p>
  );
}

/**
 * The gate badge: pass, warning, blocking, or never evaluated.
 *
 * Renders for any object carrying evaluation fields, which is why it takes the raw
 * data rather than a computed status — a consumer that had to decide "is this gated"
 * before rendering the badge would be the second place that decision lives, and the
 * two would eventually disagree.
 */
export function EvaluationGateBadge({ data }: { data: Record<string, unknown> }) {
  const t = useTranslations('creationCanvas.evaluationGate');
  const input: EvaluationGateInput = {
    passRate: typeof data.passRate === 'number' ? data.passRate : null,
    baselinePassRate: typeof data.baselinePassRate === 'number' ? data.baselinePassRate : null,
    gate: (data.gate ?? null) as EvaluationGateInput['gate'],
    slices: Array.isArray(data.slices) ? (data.slices as EvaluationGateInput['slices']) : null,
    goldenDatasetId: typeof data.goldenDatasetId === 'string' ? data.goldenDatasetId : null,
    judgeModel: typeof data.judgeModel === 'string' ? data.judgeModel : null,
  };
  // Nothing to say about an object that carries no evaluation at all — the badge is
  // for scored things, and an unconfigured card should not sprout a warning.
  if (input.passRate == null && !data.gate && !input.goldenDatasetId) return null;

  const verdict = evaluateGate(input);
  return (
    <div className={styles.gateBadge} data-testid={`gate-${verdict.status}`} data-gate-status={verdict.status}>
      <strong>{t(verdict.status)}</strong>
      {verdict.reasons.slice(0, 2).map((reason) => (
        <span key={reason.key}>{t(`reason.${reason.key}`, reason.values)}</span>
      ))}
    </div>
  );
}
