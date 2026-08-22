'use client';

/**
 * The INSIGHTS lens over a posting's AI proposal evaluations.
 *
 * ── WHY A LENS AND NOT A CHIP ───────────────────────────────────────────────────
 * The chip beside each bid answers "how good is this one". An employer with fifteen bids
 * is asking comparative questions the chip cannot reach: is this a strong field or a weak
 * one, is anything clustered at the top, and — the one that decides whether the other two
 * mean anything — can I TRUST these numbers.
 *
 * ── THE DRIFT ROW IS THE POINT ──────────────────────────────────────────────────
 * `job_proposals.last_eval_overall` is a CACHE of the newest evaluation. A bid revised
 * after it was scored carries a number about a cover note that no longer exists, and no
 * per-row chip can show that because the chip IS the stale number. So the lens compares
 * the cache against the latest `proposal_evaluations` row and says so in plain terms.
 *
 * ── AND THE METHOD SPLIT ────────────────────────────────────────────────────────
 * A lexical fallback score and an LLM-judged score are not the same measurement. Sorting a
 * table by a column that means two different things per row is worse than not ranking at
 * all, so the split is stated rather than averaged away.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getProposalEvalLens, type ProposalEvalLens } from '@/lib/freelance/matching';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 14, minWidth: 0,
};

const stat = (label: string, value: string) => (
  <div key={label} style={{ minWidth: 96 }}>
    <div style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
  </div>
);

export function ProposalEvalLensPanel({ jobId }: { jobId: string }) {
  const t = useTranslations('gigs');
  const [lens, setLens] = useState<ProposalEvalLens | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProposalEvalLens(jobId)
      .then((result) => { if (!cancelled) setLens(result); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('evalLens.loading')}</p>;
  if (error) return <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>;
  if (!lens) return null;

  if (lens.evaluatedCount === 0) {
    return (
      <div style={{ ...card, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
        {t('evalLens.none')}
      </div>
    );
  }

  const widest = Math.max(1, ...lens.bands.map((band) => band.count));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('evalLens.heading')}
        </h3>
        <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', maxWidth: '65ch' }}>
          {t('evalLens.explainer')}
        </p>
      </div>

      <div style={{ ...card, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {stat(t('evalLens.coverage'), `${lens.evaluatedCount}/${lens.proposalCount}`)}
        {stat(t('evalLens.average'), lens.averageOverall == null ? '—' : String(lens.averageOverall))}
        {stat(t('evalLens.median'), lens.medianOverall == null ? '—' : String(lens.medianOverall))}
        {stat(t('evalLens.runs'), String(lens.totalRuns))}
      </div>

      {/* Distribution — five bands, because a histogram of fifteen bids into twenty
          buckets is noise wearing a chart. */}
      <div style={card}>
        <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>
          {t('evalLens.distribution')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lens.bands.map((band) => (
            <div key={band.from} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', width: 60, flexShrink: 0 }}>
                {band.from}–{band.to}
              </span>
              <div style={{ flex: 1, minWidth: 0, height: 10, borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(band.count / widest) * 100}%`, height: '100%',
                    background: 'linear-gradient(90deg, var(--coral-bright), var(--coral-dark))',
                  }}
                />
              </div>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', width: 28, textAlign: 'right', flexShrink: 0 }}>{band.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...card, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {stat(t('evalLens.methodLlm'), String(lens.methodSplit.llm))}
        {stat(t('evalLens.methodLexical'), String(lens.methodSplit.lexical))}
        {lens.methodSplit.llm > 0 && lens.methodSplit.lexical > 0 && (
          <p style={{ margin: 0, flex: 1, minWidth: 200, fontSize: 'var(--font-size-small)', color: 'var(--warning-text, var(--warning))' }}>
            {t('evalLens.mixedMethods')}
          </p>
        )}
      </div>

      {lens.driftedCount > 0 && (
        <div style={{ ...card, borderColor: 'var(--coral-bright)' }}>
          <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--coral-bright)', marginBottom: 4 }}>
            {t('evalLens.driftHeading', { count: lens.driftedCount })}
          </div>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: '65ch' }}>
            {t('evalLens.driftBody', { max: lens.maxDrift })}
          </p>
        </div>
      )}
    </div>
  );
}
