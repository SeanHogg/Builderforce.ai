// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { atsApi, type DistributionBoard, type PostingDistribution } from '@/lib/hiringApi';
import { distributionListingFromCard, distributionRowsFrom } from '@/lib/canvasHiringPostingTools';
import { useFormat } from '@/i18n/useFormat';
import { faultText } from '@/lib/apiClient';

/**
 * The `jobPosting` card's Distribute control (FO-B4) — pick boards, publish, see where
 * it is live.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────────────
 * The publication list comes from `GET /api/ats/postings/:id/distributions` — the
 * `job_posting_distributions` rows each board confirmed — and NOT from the card's own
 * `distribution` field. The field is a projection this control (and the Brain tool,
 * and the sync tool) rewrites from the same rows after every press, through
 * `distributionRowsFrom`, so the card and the record cannot drift into two answers.
 *
 * ── WHY A DIRECT CALL AND NOT A BrainAction ──────────────────────────────────────
 * A person pressing Distribute IS the authority the approval gate asks for, the same
 * way `CanvasLegalDocumentUpload` uploads directly: the Brain's path to the same act
 * (`canvas_distribute_job_posting`) is the one that re-evaluates the gate, because
 * there the model is the actor. The server gate (MANAGER) applies to both.
 */
export function CanvasJobDistribution({ data, onEdit }: {
  data: CreationNodeData;
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('creationCanvas.jobDistribution');
  const fmt = useFormat();
  const postingId = typeof data.postingId === 'string' ? data.postingId.trim() : '';
  const [distributions, setDistributions] = useState<PostingDistribution[]>([]);
  const [boards, setBoards] = useState<DistributionBoard[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!postingId) return undefined;
    let live = true;
    setLoading(true);
    setError('');
    atsApi.postings.distributions(postingId)
      .then((read) => {
        if (!live) return;
        setDistributions(read.distributions);
        setBoards(read.boards);
      })
      .catch((err: unknown) => { if (live) setError(faultText(err, t('readFailed'))); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [postingId, t]);

  if (!postingId) {
    return <p className={`${styles.jobDistribution} ${styles.jobDistributionHint}`}>{t('needsPosting')}</p>;
  }

  // A board that already confirmed the posting is not offered again — a second create is
  // a second posting on every board but the feed.
  const liveOn = new Set(distributions.filter((row) => row.status === 'posted').map((row) => row.connectorKey));
  const choosable = boards.filter((board) => !liveOn.has(board.connectorKey));

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const distribute = async () => {
    if (!onEdit || !selected.size) return;
    setBusy(true);
    setError('');
    try {
      const result = await atsApi.postings.distribute(postingId, {
        connectorKeys: [...selected],
        listing: distributionListingFromCard(data as Record<string, unknown>),
      });
      setDistributions(result.distributions);
      setSelected(new Set());
      onEdit({ distribution: distributionRowsFrom(result.distributions) });
    } catch (err) {
      setError(faultText(err, t('distributeFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.jobDistribution} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
      <strong className={styles.jobDistributionTitle}>{t('title')}</strong>

      {distributions.length > 0 ? (
        <ul className={styles.jobDistributionList}>
          {distributions.map((row) => (
            <li key={row.connectorKey} data-status={row.status}>
              <span className={styles.jobDistributionBoard}>{row.board}</span>
              <span className={styles.jobDistributionStatus} data-status={row.status}>
                {row.status === 'posted' ? t('statusPosted') : t('statusFailed')}
              </span>
              {row.status === 'posted' && row.postedAt && (
                <small>{t('postedOn', { date: fmt.date(row.postedAt) })}</small>
              )}
              {row.status === 'posted' && row.url && (
                <a href={row.url} target="_blank" rel="noopener noreferrer">{t('view')}</a>
              )}
              {row.status === 'failed' && row.lastError && (
                <small className={styles.jobDistributionError}>{row.lastError}</small>
              )}
            </li>
          ))}
        </ul>
      ) : !loading && <small>{t('noneYet')}</small>}

      {loading ? <small>{t('loading')}</small> : boards.length === 0 ? (
        <small>
          {t('noBoards')} <Link href="/settings/integrations">{t('connectBoards')}</Link>
        </small>
      ) : choosable.length > 0 && (
        <fieldset className={styles.jobDistributionBoards} disabled={!onEdit || busy}>
          <legend>{t('chooseBoards')}</legend>
          {choosable.map((board) => (
            <label key={board.connectorKey}>
              <input
                type="checkbox"
                checked={selected.has(board.connectorKey)}
                onChange={() => toggle(board.connectorKey)}
              />
              <span aria-hidden="true">{board.icon}</span>
              <span>{board.name}</span>
            </label>
          ))}
        </fieldset>
      )}

      {choosable.length > 0 && (
        <button type="button" disabled={!onEdit || busy || selected.size === 0} onClick={() => void distribute()}>
          {busy ? t('distributing') : t('distribute', { count: selected.size })}
        </button>
      )}
      {error && <p role="alert" className={styles.jobDistributionError}>{error}</p>}
    </div>
  );
}
