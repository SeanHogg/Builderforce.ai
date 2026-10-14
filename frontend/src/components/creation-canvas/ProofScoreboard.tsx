/**
 * The proof scoreboard (PRD 33 D12, §5.3): what a proof's visitors did, against
 * the kill condition its charter wrote down before they arrived.
 *
 * The kill condition in words, sample and success progress, days left and a status
 * pill (collecting / on track / at risk / met / missed); then the three moves the
 * evidence supports — watch the visitors who did not convert, read why it missed
 * (the patterns cited at grading, and the fix prescribed for it — rule
 * `proof_missed_reason`, THE fix card, compact), and call it early with a written
 * reason — and, once graded, "Read again with what we learned". Renders nothing for a proof
 * whose target declares no measure: there is no visitor number to show.
 *
 * Shown on the proof card (`/realize`) and at the top of the canvas Visitors
 * surface when the board's app is a proof (`ProjectProofScoreboard`).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ProofEvaluationDto } from '@builderforce/interaction-contract';
import type { Realization } from '@/lib/realizationApi';
import { useFormat } from '@/i18n/useFormat';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { useProofMeasure } from './useProofMeasure';
import { ProofEarlyCallPanel } from './ProofEarlyCallPanel';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import {
  daysLeft,
  nonConvertingHref,
  percentOf,
  readAgainHref,
  scoreboardStatus,
  STATUS_TONE,
} from './proofScoreboardModel';

export interface ProofScoreboardProps {
  realization: Pick<Realization, 'id' | 'verdict' | 'sessionId' | 'spec'> & { measure?: Realization['measure'] };
  /** After an early call — the caller's copy of the realization is now graded. */
  onRealizationChange?: (realization: Realization) => void;
}

const card: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  background: 'var(--surface-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  minWidth: 0,
};

function Bar({ label, valueText, pct }: { label: string; valueText: string; pct: number }) {
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{valueText}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{ height: 8, borderRadius: 4, background: 'var(--surface)', overflow: 'hidden', border: '1px solid var(--border)' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

export function ProofScoreboard({ realization, onRealizationChange }: ProofScoreboardProps) {
  const t = useTranslations('creationCanvas.proof');
  const fmt = useFormat();
  const errorMessage = useErrorMessage();
  const measured = !!realization.measure;
  const { evaluation, loading, error, reload } = useProofMeasure(measured ? realization.id : null);
  const [calling, setCalling] = useState(false);

  if (!measured) return null;
  if (loading && !evaluation) {
    return <section style={card} aria-busy="true" data-testid="proof-scoreboard"><p role="status" style={{ margin: 0 }}>{t('loading')}</p></section>;
  }
  if (error || !evaluation) {
    return (
      <section style={card} data-testid="proof-scoreboard">
        <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{errorMessage(error) ?? t('loadFailed')}</p>
      </section>
    );
  }

  const now = new Date();
  const verdict = realization.verdict;
  const status = scoreboardStatus(evaluation, verdict, now);
  const left = daysLeft(evaluation.windowEndsAt, now);
  const graded = verdict === 'met' || verdict === 'missed';
  const isRate = evaluation.threshold.unit === 'rate';
  const asValue = (n: number) => (isRate ? fmt.number(n, { style: 'percent', maximumFractionDigits: 1 }) : fmt.number(n));

  return (
    <section style={card} aria-labelledby={`proof-scoreboard-${realization.id}`} data-testid="proof-scoreboard">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 id={`proof-scoreboard-${realization.id}`} style={{ margin: 0, fontSize: 15, color: 'var(--text-primary)' }}>{t('title')}</h3>
        <span
          data-status={status}
          style={{ padding: '2px 10px', borderRadius: 'var(--radius-full)', border: `1px solid ${STATUS_TONE[status]}`, color: STATUS_TONE[status], fontSize: 12, fontWeight: 700 }}
        >
          {t(`status.${status}`)}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
        {t(evaluation.threshold.op === '>=' ? 'killAtLeast' : 'killAtMost', {
          event: evaluation.measure.success.ref,
          target: asValue(evaluation.threshold.value),
          sample: fmt.number(evaluation.sampleMin),
          days: fmt.number(evaluation.measure.windowDays),
        })}
      </p>

      <Bar
        label={t('sample')}
        valueText={t('sampleOf', { n: fmt.number(evaluation.sampleN), min: fmt.number(evaluation.sampleMin) })}
        pct={percentOf(evaluation.sampleN, evaluation.sampleMin)}
      />
      <Bar
        label={t('success')}
        valueText={t('successOf', { n: asValue(evaluation.value), target: asValue(evaluation.threshold.value) })}
        pct={percentOf(evaluation.value, evaluation.threshold.value)}
      />

      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
        {left === null ? t('windowNotStarted') : left === 0 ? t('windowClosed') : t('daysLeft', { days: fmt.number(left) })}
      </p>

      {status === 'missed' && <WhyItMissed evaluation={evaluation} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {evaluation.siteId && (
          <Link className="btn-secondary" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={nonConvertingHref(evaluation.siteId, evaluation.measure)}>
            {t('watch')}
          </Link>
        )}
        {!graded && verdict !== 'abandoned' && (
          <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => setCalling(true)}>
            {t('callEarly')}
          </button>
        )}
        {graded && (
          <Link
            className="btn-primary"
            style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
            href={readAgainHref({ realizationId: realization.id, idea: realization.spec?.goal ?? '', sessionId: realization.sessionId })}
          >
            {t('readAgain')}
          </Link>
        )}
      </div>

      <ProofEarlyCallPanel
        realizationId={realization.id}
        open={calling}
        onClose={() => setCalling(false)}
        onCalled={(updated) => { onRealizationChange?.(updated); reload(); }}
      />
    </section>
  );
}

function WhyItMissed({ evaluation }: { evaluation: ProofEvaluationDto }) {
  const t = useTranslations('creationCanvas.proof');
  const tFixes = useTranslations('replay.fixes');
  const { items: fixes } = usePrescriptionsFor({
    siteId: evaluation.siteId,
    ruleId: 'proof_missed_reason',
    subject: `proof:${evaluation.realizationId}`,
  });
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <h4 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>{t('whyMissed')}</h4>
      {evaluation.patterns.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('noPatterns')}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13, color: 'var(--text-primary)' }}>
          {evaluation.patterns.map((pattern) => (
            <li key={pattern.text} style={{ overflowWrap: 'anywhere' }}>{pattern.text}</li>
          ))}
        </ul>
      )}
      {evaluation.siteId && fixes.length > 0 && (
        <section aria-label={tFixes('proofTitle')} style={{ display: 'grid', gap: 6 }}>
          <h5 style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)' }}>{tFixes('proofTitle')}</h5>
          {fixes.map((p) => <PrescriptionCard key={p.id} compact siteId={evaluation.siteId ?? ''} prescription={p} />)}
        </section>
      )}
    </div>
  );
}
