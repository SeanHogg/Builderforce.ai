import { useCallback, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePolledResource } from '@/hooks/usePolledResource';
import { ApiRequestError } from '@/lib/apiClient';
import { knowledgeSurfaceHref } from '@/lib/knowledge/knowledgeChipRoute';
import {
  FactOwnedByPersonError,
  captureLearningBaseline,
  getLearningPipeline,
  reviewLearningCandidate,
  transferLearningCandidate,
  type LearningPipelineReport,
} from '@/lib/projectEvermindApi';

/**
 * Manager review surface for the Evermind learning pipeline (roadmap 07bc5793).
 * Baseline capture, the four key-result numbers, and approve / reject / transfer
 * of pending candidates. Hidden for callers the API refuses (non-managers).
 */
export function EvermindLearningReview({ projectId }: { projectId: number | null }) {
  const t = useTranslations('evermindBrain');
  const [report, setReport] = useState<LearningPipelineReport | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A transfer refused because a person owns the fact key: which learning, and the key. */
  const [owned, setOwned] = useState<{ id: number; factKey: string } | null>(null);

  const reload = useCallback(async () => {
    if (projectId == null) return;
    try {
      setReport(await getLearningPipeline(projectId));
      setHidden(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 403 || err.status === 404)) {
        setHidden(true);
        return;
      }
      setError(err instanceof Error ? err.message : t('error'));
    }
  }, [projectId, t]);

  // Load once per project (`maxTicks: 0` = the immediate read only); actions reload explicitly.
  usePolledResource(() => reload(), { intervalMs: 60_000, enabled: projectId != null, maxTicks: 0, restartKey: projectId });

  const act = useCallback(async (fn: () => Promise<unknown>, candidate?: { id: number; factKey: string }) => {
    setBusy(true);
    setError(null);
    setOwned(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      // A conflict with a person's fact is a decision for the manager, not an error banner.
      if (err instanceof FactOwnedByPersonError && candidate) setOwned(candidate);
      else setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  }, [reload, t]);

  if (projectId == null || hidden) return null;
  if (!report && !error) return null;

  const review = report?.metrics.reviewHours == null
    ? t('pipelineReviewNone')
    : t('pipelineReviewHours', { hours: report.metrics.reviewHours });
  const uplift = report?.metrics.transferUplift == null
    ? t('pipelineUpliftNone')
    : t('pipelineUplift', { uplift: report.metrics.transferUplift });

  return (
    <section style={panel} aria-label={t('pipelineTitle')}>
      <div style={head}>
        <span style={title}>{t('pipelineTitle')}</span>
        <button
          type="button"
          style={chip}
          disabled={busy}
          onClick={() => void act(() => captureLearningBaseline(projectId))}
        >
          {busy ? t('pipelineCapturing') : t('pipelineCapture')}
        </button>
      </div>
      {error && <p style={errLine}>{error}</p>}
      {report && (
        <>
          <p style={meta}>
            {report.baseline
              ? t('pipelineBaseline', { version: report.baseline.headVersion, count: report.baseline.factCount })
              : t('pipelineNoBaseline')}
          </p>
          <p style={meta}>
            {t('pipelineMetrics', {
              extraction: report.metrics.extractionRate,
              contradictions: report.metrics.contradictionRate,
              review,
            })}
            {' · '}
            {uplift}
          </p>
          {report.pending.length === 0 ? (
            <p style={meta}>{t('pipelineEmpty')}</p>
          ) : (
            <ul style={list}>
              {report.pending.map((row) => (
                <li key={row.id} style={item}>
                  <div style={statement}>{row.statement}</div>
                  {row.contradicts && <div style={warn}>{t('pipelineContradicts')}</div>}
                  <div style={actions}>
                    <button type="button" style={chip} disabled={busy} onClick={() => void act(() => reviewLearningCandidate(projectId, row.id, 'approved'))}>{t('pipelineApprove')}</button>
                    <button type="button" style={chip} disabled={busy} onClick={() => void act(() => reviewLearningCandidate(projectId, row.id, 'rejected'))}>{t('pipelineReject')}</button>
                    <button type="button" style={chip} disabled={busy} onClick={() => void act(() => transferLearningCandidate(projectId, row.id), { id: row.id, factKey: row.factKey })}>{t('pipelineTransfer')}</button>
                  </div>
                  {owned?.id === row.id && (
                    <div role="alert" style={ownedNote}>
                      <span>{t('pipelineFactOwned', { key: owned.factKey })}</span>
                      <span style={actions}>
                        <Link href={knowledgeSurfaceHref(projectId, { focus: [`fact:${owned.factKey}`], review: false })} style={chip}>{t('pipelineOpenFact')}</Link>
                        <button type="button" style={chip} disabled={busy} onClick={() => void act(() => reviewLearningCandidate(projectId, row.id, 'rejected'))}>{t('pipelineReject')}</button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const panel: CSSProperties = {
  flex: '0 0 auto',
  maxHeight: 220,
  overflow: 'auto',
  borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
};
const head: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const title: CSSProperties = { fontWeight: 600 };
const meta: CSSProperties = { margin: '4px 0', opacity: 0.75 };
const errLine: CSSProperties = { margin: '4px 0', color: 'var(--danger)' };
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 };
const item: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const statement: CSSProperties = { lineHeight: 1.35 };
const warn: CSSProperties = { color: 'var(--warning)', fontSize: 'var(--font-size-eyebrow)' };
const ownedNote: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '6px 8px',
  border: '1px solid var(--warning)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--warning)',
  fontSize: 'var(--font-size-eyebrow)',
  overflowWrap: 'anywhere',
};
const actions: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const chip: CSSProperties = {
  border: '1px solid var(--border, rgba(255,255,255,0.16))',
  background: 'transparent',
  color: 'inherit',
  borderRadius: 'var(--radius-full)',
  padding: '2px 8px',
  fontSize: 'var(--font-size-eyebrow)',
  cursor: 'pointer',
  textDecoration: 'none',
};
