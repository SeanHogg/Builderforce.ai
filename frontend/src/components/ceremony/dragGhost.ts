/**
 * A drag GHOST that says what you are dragging.
 *
 * Native HTML5 drag renders a translucent snapshot of the element under the cursor. On
 * the ceremony stage — dense stacks of small cards on a dark surface — that snapshot is a
 * washed-out rectangle with no legible text, so an operator drags by position and hopes.
 * The keyboard/touch path (`pickToPlace`) never had this problem because it names the
 * picked ticket outright; dragging is the only interaction that did not.
 *
 * Implemented with `setDragImage` over a detached node rather than by adopting a
 * pointer-based DnD library: the drop targets, the touch path and the keyboard path all
 * work today, and replacing a working interaction to add a visual affordance would be a
 * far larger change than the affordance is worth.
 *
 * THE DETACHED NODE HAS TO BE IN THE DOCUMENT at the moment `setDragImage` reads it —
 * a node with `display:none`, or one never appended, produces no image at all — so it is
 * appended off-screen and removed on the next frame, after the browser has snapshotted it.
 */

/** How far off-screen the ghost is parked while the browser snapshots it. */
const OFFSCREEN_PX = -10_000;

/**
 * Give this drag a labelled ghost. Best-effort: any browser that refuses
 * `setDragImage` simply keeps its default, and the drag still works.
 */
export function setDragGhost(event: React.DragEvent, label: string): void {
  try {
    if (typeof document === 'undefined' || !event.dataTransfer?.setDragImage) return;
    const ghost = document.createElement('div');
    ghost.textContent = label;
    // Theme tokens, not literals — the ghost renders over whichever theme the operator
    // is in, and a hardcoded colour is invisible in one of them.
    Object.assign(ghost.style, {
      position: 'fixed',
      top: `${OFFSCREEN_PX}px`,
      left: `${OFFSCREEN_PX}px`,
      maxWidth: '260px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      padding: '6px 10px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--coral-bright)',
      background: 'var(--bg-elevated)',
      color: 'var(--text-primary)',
      font: '600 12px/1.3 var(--font-sans, system-ui)',
      boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    // Offset so the cursor sits just inside the ghost rather than at its corner.
    event.dataTransfer.setDragImage(ghost, 12, 12);
    // The snapshot is taken synchronously during this event; the node is only needed
    // until the frame ends.
    requestAnimationFrame(() => ghost.remove());
  } catch {
    // A browser that refuses setDragImage keeps its default ghost. Never break the drag.
  }
}
