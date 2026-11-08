// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './styles/panels.module.css';
import { atsApi, type BoardJob, type LinkableBoard, type PostingDistribution } from '@/lib/hiringApi';
import { faultText } from '@/lib/apiClient';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';

/**
 * "Link an existing board job" — attach a posting to a job that already exists on a
 * connected board (Workable, whose API cannot create jobs, or any board where the job was
 * made outside BuilderForce), so the posting gets a confirmed publication and its
 * applicants can be imported.
 *
 * Its own component with its own state: pick a board, the board's jobs are read, pick one,
 * confirm. It reports the posting's whole publication list through `onLinked`, so the
 * parent redraws from the response that wrote it.
 *
 * The control is rendered DISABLED, never hidden, for anyone below manager (the server
 * gate is MANAGER): {@link RoleGate} shows the role the action needs, and `disabled` also
 * stops keyboard changes that a click-blocking wrapper cannot.
 */
export function BoardJobLinkPicker({ postingId, boards, canEdit, onLinked }: {
  postingId: string;
  /** Connected boards whose jobs can be linked and that the posting is not yet live on. */
  boards: readonly LinkableBoard[];
  /** False when the card is read-only (no `onEdit`). */
  canEdit: boolean;
  onLinked: (distributions: PostingDistribution[]) => void;
}) {
  const t = useTranslations('creationCanvas.jobDistribution');
  const { allowed } = usePermission('hiring.manage');
  const [board, setBoard] = useState('');
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [job, setJob] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (boards.length === 0) return null;
  const disabled = !canEdit || !allowed || busy;

  const chooseBoard = async (key: string) => {
    setBoard(key);
    setJob('');
    setJobs([]);
    setError('');
    if (!key) return;
    setBusy(true);
    try {
      setJobs((await atsApi.postings.boardJobs(postingId, key)).jobs);
    } catch (err) {
      setError(faultText(err, t('boardJobsFailed')));
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!board || !job) return;
    setBusy(true);
    setError('');
    try {
      const result = await atsApi.postings.linkBoardJob(postingId, { connectorKey: board, externalId: job });
      setBoard('');
      setJob('');
      setJobs([]);
      onLinked(result.distributions);
    } catch (err) {
      setError(faultText(err, t('linkFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleGate capability="hiring.manage" variant="block" silent={false}>
      <fieldset className={styles.jobDistributionLink} disabled={disabled}>
        <legend>{t('linkTitle')}</legend>
        <select aria-label={t('linkBoardLabel')} value={board} onChange={(event) => void chooseBoard(event.target.value)}>
          <option value="">{t('linkChooseBoard')}</option>
          {boards.map((entry) => <option key={entry.connectorKey} value={entry.connectorKey}>{entry.name}</option>)}
        </select>
        {board && (
          <select aria-label={t('linkJobLabel')} value={job} onChange={(event) => setJob(event.target.value)}>
            <option value="">{jobs.length ? t('linkChooseJob') : t('linkNoJobs')}</option>
            {jobs.map((entry) => (
              <option key={entry.externalId} value={entry.externalId}>
                {entry.state ? `${entry.title} (${entry.state})` : entry.title}
              </option>
            ))}
          </select>
        )}
        <button type="button" disabled={disabled || !job} onClick={() => void link()}>{t('linkConfirm')}</button>
        {error && <p role="alert" className={styles.jobDistributionError}>{error}</p>}
      </fieldset>
    </RoleGate>
  );
}
