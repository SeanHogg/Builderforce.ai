import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import type { CreationSnapshotSummary } from '@/lib/builderforceApi';
import type { LocalCheckpointSummary } from '@/lib/creationCheckpoints';
import { useCanvasSessionFacts } from '../chrome/canvasSessionContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasHistoryPanelProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  history: readonly CreationSnapshotSummary[];
  localCheckpoints: readonly LocalCheckpointSummary[];
  checkpointName: string;
  setCheckpointName: Dispatch<SetStateAction<string>>;
  createCheckpoint: () => void;
  restoreRevision: (revision: number) => void;
  restoreLocalCheckpoint: (checkpointId: string) => void;
}

/**
 * ONE history panel over TWO stores. A saved board restores a server revision;
 * a local one restores a checkpoint held in this browser (`creationCheckpoints.ts`).
 * The verbs, the layout and the empty state are shared — only the row source
 * and the identifier differ, which is exactly as much as genuinely differs.
 */
export function CanvasHistoryPanel({ open, setOpen, history, localCheckpoints, checkpointName, setCheckpointName, createCheckpoint, restoreRevision, restoreLocalCheckpoint }: CanvasHistoryPanelProps) {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  const { persistence, canEdit } = useCanvasSessionFacts();
  if (!open) return null;
  return <aside className={styles.historyPanel}>
          <header>
            <div>
              <strong>{t('versionHistory')}</strong>
              <small>{persistence === 'server' ? t('versionHistoryHint') : t('versionHistoryLocalHint')}</small>
            </div>
            <button onClick={() => setOpen(false)} aria-label={t('closeHistory')}>×</button>
          </header>
          <form
            className={styles.checkpointForm}
            onSubmit={(event) => { event.preventDefault(); createCheckpoint(); }}
          >
            {/* `aria-label` rather than a visually-hidden <label>: this stylesheet has no
                sr-only utility, and inventing one for a single field is a second way to
                hide text that the next person has to discover. The placeholder is a
                HINT and is never the accessible name — a placeholder disappears the
                moment somebody types, which is precisely when they might ask what the
                field was for. */}
            <input
              aria-label={t('checkpointNameLabel')}
              value={checkpointName}
              onChange={(event) => setCheckpointName(event.target.value)}
              placeholder={t('checkpointNamePlaceholder')}
              maxLength={120}
              disabled={!canEdit}
            />
            <button type="submit" className={styles.primaryButton} disabled={!canEdit || !checkpointName.trim()}>{t('nameCheckpoint')}</button>
          </form>
          <div>
            {persistence === 'server'
              ? (history.length
                ? history.map((snapshot) => <button key={snapshot.revision} onClick={() => restoreRevision(snapshot.revision)} disabled={!canEdit}>
                  <b>{snapshot.label || t('revisionLabel', { revision: snapshot.revision })}</b>
                  <span>{t('revisionMeta', { revision: snapshot.revision, at: fmt.dateTime(snapshot.createdAt) })}</span>
                </button>)
                : <p>{t('noRevisions')}</p>)
              : (localCheckpoints.length
                ? localCheckpoints.map((checkpoint) => <button key={checkpoint.id} onClick={() => restoreLocalCheckpoint(checkpoint.id)} disabled={!canEdit}>
                  <b>{checkpoint.label}</b>
                  <span>{t('checkpointMeta', { count: checkpoint.objectCount, at: fmt.dateTime(checkpoint.at) })}</span>
                </button>)
                : <p>{t('noCheckpoints')}</p>)}
          </div>
        </aside>;
}
