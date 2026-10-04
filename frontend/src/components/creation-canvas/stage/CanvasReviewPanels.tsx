import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import type { ProposedCanvasChange } from '@/domains/canvas/domain/canvasChange';
import type { MergeReview } from '../canvasBoardTypes';
import styles from '../CreationCanvas.module.css';

export interface CanvasChangeSetPanelProps {
  changes: readonly ProposedCanvasChange[];
  accepted: ReadonlySet<string>;
  setAccepted: Dispatch<SetStateAction<Set<string>>>;
  onReject: () => void;
  onApplyAndAutoApply: () => void;
  onApply: () => void;
}

/** What Brain proposes to change, one tick per change, before any of it lands. */
export function CanvasChangeSetPanel({ changes, accepted, setAccepted, onReject, onApplyAndAutoApply, onApply }: CanvasChangeSetPanelProps) {
  const t = useTranslations('creationCanvas');
  if (!changes.length) return null;
  const toggle = (changeId: string) => setAccepted((current) => { const next = new Set(current); if (next.has(changeId)) next.delete(changeId); else next.add(changeId); return next; });
  return <aside className={styles.changeSetPanel}><header><div><strong>{t('reviewBrainChanges')}</strong><small>{t('reviewBrainChangesHint')}</small></div><button onClick={onReject} aria-label={t('closeChangeSet')}>×</button></header><div>{changes.map((change) => <label key={change.id}><input type="checkbox" checked={accepted.has(change.id)} onChange={() => toggle(change.id)} /><span><b>{change.label}</b><small>{change.type.replace('.', ' ')}</small></span></label>)}</div><footer><button className={styles.secondaryButton} onClick={onReject}>{t('rejectAll')}</button><button className={styles.secondaryButton} disabled={!accepted.size} onClick={onApplyAndAutoApply} title={t('applyAutoApplyHint')}>{t('applyAutoApply')}</button><button className={styles.primaryButton} disabled={!accepted.size} onClick={onApply}>{t('applySelected', { count: accepted.size })}</button></footer></aside>;
}

export interface CanvasMergePanelProps {
  review: MergeReview | null;
  setReview: Dispatch<SetStateAction<MergeReview | null>>;
  onApply: () => void;
}

/** A branch coming home: per object, which version wins. */
export function CanvasMergePanel({ review, setReview, onApply }: CanvasMergePanelProps) {
  const t = useTranslations('creationCanvas');
  if (!review) return null;
  return <aside className={styles.mergePanel}><header><div><strong>{t('mergeBranch')}</strong><p>{t('mergeBranchHint')}</p></div><button onClick={() => setReview(null)} aria-label={t('closeMergeReview')}>×</button></header>{review.items.map((item) => <label key={item.key}><b>{item.source.data.title}</b><small>{item.target ? t('mergeBothContain', { kind: item.source.data.kind }) : t('mergeNewFromBranch', { kind: item.source.data.kind })}</small>{item.target && <span><select aria-label={t('mergeChoiceFor', { title: item.source.data.title })} value={item.choice} onChange={(event) => setReview((current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, choice: event.target.value as 'branch' | 'parent' } : candidate) } : current)}><option value="branch">{t('useBranchVersion')}</option><option value="parent">{t('keepParentVersion')}</option></select></span>}</label>)}<button className={styles.primaryButton} onClick={onApply}>{t('applyReviewedMerge')}</button></aside>;
}
