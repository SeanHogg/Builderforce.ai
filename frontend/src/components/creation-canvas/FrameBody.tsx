// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useTranslations } from 'next-intl';
import { isFrameCollapsed } from '@/domains/canvas/domain/canvasFrame';
import { FlowExecutionSettings } from './FlowExecutionSettings';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * THE BOUNDING BOX — a section of the board, as a thing you can put away.
 *
 * A frame used to be a rectangle drawn behind some cards, with a purpose written
 * on it. On a board that IS a workflow, twenty steps is a small flow, and a
 * rectangle that cannot be closed is decoration on a canvas that keeps growing.
 *
 * This card gives it the two operations that make it a container:
 *
 *  • COLLAPSE — put the section away. Everything inside disappears with it and the
 *    frame becomes a chip naming the section and counting what it holds.
 *    Connections into and out of the section re-point at the chip
 *    (`visibleEndpoint`), so a put-away section still reads as part of the flow
 *    rather than as the place the flow stops.
 *
 *  • OPEN — work on the section at the size of a screen instead of the size of the
 *    board: a canvas within a canvas. This is what replaced the modal workflow
 *    editor. The modal was a SECOND canvas with its own palette, node renderer and
 *    selection model, over a board that already had all three; opening a frame is
 *    the same board, showing one section.
 *
 * Membership is geometric and lives in `canvasFrame.ts` — this card only draws what
 * that decided. Self-contained: it renders nothing it is not entitled to, so a
 * read-only board (no `onEdit`) gets a frame it can open and cannot collapse.
 */

export interface FrameBodyProps {
  data: CreationNodeData;
  /** How many objects the frame currently holds, at any depth. */
  memberCount: number;
  /** Collapse/expand. Absent on a board this viewer may not edit. */
  onToggleCollapsed?: () => void;
  /** Show this section on its own. Absent where drilling in is not offered. */
  onOpen?: () => void;
}

export function FrameBody({ data, memberCount, onToggleCollapsed, onOpen }: FrameBodyProps) {
  // Two namespaces, deliberately: the frame's own caption strings have always lived
  // with the CARD copy (`creationCanvas.node`), and the container operations added here
  // are their own group. Reaching for `creationCanvas` wholesale would have quietly
  // rendered the dotted key where the caption belongs.
  const tNode = useTranslations('creationCanvas.node');
  const t = useTranslations('creationCanvas.frameSection');
  const collapsed = isFrameCollapsed(data);

  return (
    <div className={styles.frameBody} data-collapsed={collapsed ? 'true' : 'false'} data-testid="canvas-frame-body">
      {!collapsed && <strong>{String(data.framePurpose || tNode('arrangeObjects'))}</strong>}
      {!collapsed && <p>{data.subtitle || tNode('frameFallback')}</p>}
      {/* A section that bounds a FLOW says where it runs and whether it may run
          unattended — the two facts that decide what Run does, on the object Run acts
          on. It renders nothing on an ordinary bounding box, so a frame full of cards
          is not captioned with an execution target it does not have. */}
      {!collapsed && <FlowExecutionSettings data={data} />}
      <div className={`${styles.frameActions} nodrag`}>
        <span className={styles.frameCount}>{t('holds', { count: memberCount })}</span>
        {onToggleCollapsed && <button
          type="button"
          data-testid="canvas-frame-collapse"
          aria-expanded={!collapsed}
          onClick={(event) => { event.stopPropagation(); onToggleCollapsed(); }}
        >{collapsed ? t('expand') : t('collapse')}</button>}
        {onOpen && !collapsed && <button
          type="button"
          data-testid="canvas-frame-open"
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
        >{t('open')}</button>}
      </div>
    </div>
  );
}
