'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { WorkspaceCanvasPanel } from './WorkspaceCanvas';
import styles from './WorkspaceCanvas.module.css';

/**
 * The same panels, as a PAGE.
 *
 * `WorkspaceCanvas` lays these out spatially — absolute coordinates, pan, zoom,
 * a minimap. That is right for a board somebody arranges, and wrong for a
 * destination that opens in the slide-out panel over one: `/dashboard` rendered
 * a second pannable canvas *inside a drawer*, with its own zoom rail and dotted
 * ground, so reading your own metrics meant panning a board inside a panel that
 * was already over a board.
 *
 * So the panel list is the other rendering of the same data. Nothing about a
 * `WorkspaceCanvasPanel` is canvas-specific except `position`; a page reads the
 * title, the icon and the content exactly as a node does, which is why this is a
 * second RENDERER rather than a second model. `WorkspaceCanvas` already had one
 * of these for phones and kept it private — it is shared now, so the phone
 * layout and the page layout cannot drift.
 *
 * Width is the only spatial hint it honours, and it honours it as a QUESTION —
 * "is this a compact tile or a full-width section?" — rather than as pixels. The
 * five 270px metric cards become a responsive row; everything else takes the
 * width it is given. No new field: the answer is already in the data.
 */

/** Below this, a panel was authored as a tile rather than a section. */
const COMPACT_MAX_WIDTH = 320;

export function WorkspacePanelList({
  panels,
  onRemovePanel,
  className,
}: {
  panels: WorkspaceCanvasPanel[];
  onRemovePanel?: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations('workspaceCanvas');

  return (
    <div className={`${styles.pageStack}${className ? ` ${className}` : ''}`} data-testid="workspace-panel-list" data-layout="page">
      {panels.map((panel) => (
        <section
          key={panel.id}
          className={styles.pageNode}
          data-compact={panel.width != null && panel.width <= COMPACT_MAX_WIDTH ? 'true' : undefined}
          aria-label={t('panelLabel', { title: panel.title })}
        >
          <header className={styles.header}>
            <span className={styles.icon} aria-hidden><Icon source={panel.icon ?? '◇'} size={18} /></span>
            <strong className={styles.title}>{panel.title}</strong>
            {panel.subtitle && <span className={styles.subtitle}>{panel.subtitle}</span>}
            <span className={styles.spacer} />
            {panel.removable && onRemovePanel && (
              <button
                type="button"
                className={styles.close}
                aria-label={t('removePanel', { title: panel.title })}
                onClick={() => onRemovePanel(panel.id)}
              >×</button>
            )}
          </header>
          <div className={styles.pageBody}>{panel.content}</div>
        </section>
      ))}
    </div>
  );
}
