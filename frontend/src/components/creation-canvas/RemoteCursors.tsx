// No 'use client' directive: this is only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionPill` and `CanvasSessionActions` omit it.
import { useTranslations } from 'next-intl';
import { useStore, ViewportPortal } from '@xyflow/react';
import { presenceColor } from '@/lib/canvas/presenceColor';
import styles from './CreationCanvas.module.css';

/**
 * Everyone else's pointer, drawn on the board.
 *
 * ── WHY THIS IS INSIDE THE VIEWPORT ──────────────────────────────────────────
 * This was a sibling of `<ReactFlow>` that took the flow instance and the board
 * element AS PROPS, read off two refs during the parent's render, and converted
 * each cursor with `flowToScreenPosition()` minus the board's bounding box.
 *
 * That arithmetic is correct exactly once — at the instant it runs. React does
 * not re-render when a ref is assigned, and panning or zooming a React Flow board
 * does not re-render its parent either, so the only thing that ever moved those
 * cursors was the 8-second presence poll. Between two ticks the board could be
 * panned across the canvas and every remote cursor stayed nailed to the pixel it
 * was last drawn at — pointing at whatever happened to be underneath, and, after
 * any real pan, sitting outside `overflow: hidden` where it could not be seen at
 * all. "The cursors don't show" and "the cursors are in the wrong place" were the
 * same defect.
 *
 * So the layer moves INTO the viewport via `ViewportPortal`. Positions are plain
 * flow coordinates and React Flow's own pane transform carries them, which means
 * they are right during a pan rather than after one, and they cost no re-render.
 * The label is counter-scaled by the zoom so a name stays readable at 20% and does
 * not become a billboard at 400%.
 *
 * ── WHAT IS STILL POLLED ─────────────────────────────────────────────────────
 * The cursor POSITION still arrives on the 8s `/presence` cycle, because that is
 * the only channel carrying it; the canvas WebSocket is a domain-free "changed"
 * ping by design (`SessionRoomDO`). Placement is now exact, but freshness is
 * bounded by that poll — see the Gap Register entry on moving presence onto a
 * client-to-client relay.
 */

/** The shape this layer needs from a session member. */
export interface RemoteCursorMember {
  userId: string;
  displayName: string | null;
  cursor?: { x?: number; y?: number } | null;
  typing?: boolean;
}

export interface RemoteCursorsProps {
  members: readonly RemoteCursorMember[];
  /** Whoever is reading. Their own pointer is real and is never drawn. */
  currentUserId: string | null;
}

/** Members with a live pointer, excluding the reader. Exported for assertions. */
export function visibleCursors(
  members: readonly RemoteCursorMember[],
  currentUserId: string | null,
): RemoteCursorMember[] {
  return members.filter((member) =>
    member.userId !== currentUserId
    && typeof member.cursor?.x === 'number'
    && typeof member.cursor?.y === 'number');
}

export function RemoteCursors({ members, currentUserId }: RemoteCursorsProps) {
  const t = useTranslations('creationCanvas');
  // Subscribing to the zoom is what keeps the LABEL a constant size. The cursor's
  // position needs no subscription at all — the pane's transform moves it.
  const zoom = useStore((state) => (state as { transform?: [number, number, number] }).transform?.[2] ?? 1);
  const visible = visibleCursors(members, currentUserId);
  if (!visible.length) return null;

  return (
    <ViewportPortal>
      {visible.map((member) => (
        <div
          key={member.userId}
          className={styles.remoteCursor}
          aria-hidden="true"
          style={{
            transform: `translate(${member.cursor!.x!}px, ${member.cursor!.y!}px) scale(${1 / zoom})`,
            color: presenceColor(member.userId),
          }}
        >
          <i>◢</i>
          <b>{member.displayName || t('collaborator')}{member.typing ? ` ${t('cursorTyping')}` : ''}</b>
        </div>
      ))}
    </ViewportPortal>
  );
}
