import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { BrainMark } from '@/components/brain/BrainMark';
import type { BrainDockPreferences, BrainDockSide } from '../brainDockPreferences';
import styles from '../CreationCanvas.module.css';

export interface CanvasBrainLauncherProps {
  /** Nothing else is drawn over the board, Brain is closed and has no other way back. */
  visible: boolean;
  side: BrainDockSide;
  thinking: boolean;
  unreadReplies: number;
  updateBrainDock: (patch: Partial<BrainDockPreferences>) => void;
}

/**
 * The way back to a closed Brain, and the only thing that says a reply arrived
 * while it was shut. An inline Brain with its Object still on the board offers
 * its own way back, so this appears only when there is none.
 *
 * THE COUNT IS WHAT MAKES "BRAIN NEVER COVERS THE SURFACE" HONEST: on a phone
 * the dock is a sheet the reader opens, and without a count "open it when you
 * want it" means "open it every thirty seconds in case". It WINS the label when
 * there is one — "Show Brain chat" beside a badge names itself twice.
 */
export const CanvasBrainLauncher = memo(function CanvasBrainLauncher({ visible, side, thinking, unreadReplies, updateBrainDock }: CanvasBrainLauncherProps) {
  const t = useTranslations('creationCanvas');
  if (!visible) return null;
  const label = unreadReplies > 0
    ? t('brainLauncher.unread', { count: unreadReplies })
    : thinking ? t('openBrainDockBusy') : t('openBrainDock');
  return <button
    type="button"
    className={styles.brainDockLauncher}
    data-testid="canvas-brain-launcher"
    data-side={side}
    data-state={thinking ? 'running' : unreadReplies > 0 ? 'unread' : 'idle'}
    aria-label={label}
    title={label}
    onClick={() => updateBrainDock({ open: true })}
  ><BrainMark running={thinking} size={14} />{unreadReplies > 0 ? t('brainLauncher.unread', { count: unreadReplies }) : t('brain')}</button>;
});
