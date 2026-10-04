// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { ProjectVersions } from './useProjectVersions';
import styles from './workspaceChrome.module.css';

/** How long the toast stays up after an agent turn lands (or after its undo). */
const SHOW_MS = 8000;

/** What the toast is about, captured when the turn lands — the list moves on (an undo adds versions). */
interface LandedTurn {
  id: number;
  files: number;
  /** The version before the turn: what Undo restores. */
  previousId: number | null;
}

type UndoState = 'idle' | 'undoing' | 'undone' | 'failed';

/**
 * "Preview updated · 3 files · Undo", over the preview, when an agent turn lands.
 *
 * Every turn is already a version (`useProjectVersions` records one per settled
 * burst of agent writes, with the paths it touched), so Undo is a restore of the
 * version before it — which itself saves the current state first, so the undo can
 * be undone from Versions. Only versions recorded while this is mounted count: a
 * project's history is not news on open.
 */
export function PreviewChangeToast({ versions }: { versions: ProjectVersions }) {
  const t = useTranslations('ide.workspace');
  const tc = useTranslations('common');
  const list = versions.versions;
  const seenRef = useRef<number | null | undefined>(undefined);
  const [turn, setTurn] = useState<LandedTurn | null>(null);
  const [undo, setUndo] = useState<UndoState>('idle');

  // A new automatic version at the head of the list is an agent turn landing.
  useEffect(() => {
    if (list === null) return;
    const head = list[0] ?? null;
    const headId = head?.id ?? null;
    // The first list we see is history, not a change.
    if (seenRef.current === undefined) { seenRef.current = headId; return; }
    if (headId === seenRef.current) return;
    seenRef.current = headId;
    if (head?.kind !== 'auto') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTurn({ id: head.id, files: head.changed.length, previousId: list[1]?.id ?? null });
    setUndo('idle');
  }, [list]);

  // Hides itself a while after it last changed — landing, or the undo finishing.
  useEffect(() => {
    if (!turn || undo === 'undoing') return undefined;
    const timer = window.setTimeout(() => setTurn(null), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [turn, undo]);

  if (!turn) return null;

  const runUndo = async () => {
    if (turn.previousId === null) return;
    setUndo('undoing');
    try {
      await versions.restore(turn.previousId);
      setUndo('undone');
    } catch {
      setUndo('failed');
    }
  };

  return (
    <div role="status" className={styles.changeToast}>
      <Icon name="check" size={15} />
      <span style={{ flex: 1, minWidth: 0 }}>
        {undo === 'undone' ? t('changeUndone') : undo === 'failed' ? t('changeUndoFailed') : t('changeLanded', { count: turn.files })}
      </span>
      {turn.previousId !== null && undo !== 'undone' && (
        <button type="button" className={styles.changeToastAction} onClick={() => { void runUndo(); }} disabled={undo === 'undoing'}>
          {t('undo')}
        </button>
      )}
      <button type="button" className={styles.changeToastAction} onClick={() => setTurn(null)} aria-label={tc('dismiss')} title={tc('dismiss')}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
