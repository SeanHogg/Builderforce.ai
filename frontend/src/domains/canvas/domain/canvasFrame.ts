/**
 * FRAMES AS CONTAINERS — what a bounding box on the board actually holds.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * A `frame` object has existed since the board did, and it was a rectangle drawn
 * behind some cards. "Group these" drew one around the selection and that was the
 * end of the relationship: dragging the frame left its contents behind, nothing
 * could be collapsed, and a board that outgrew one screen had no way to put a
 * finished section away. On a board that IS a workflow — where twenty steps is a
 * small flow — that is the difference between a canvas you can keep working on and
 * one you stop opening.
 *
 * A frame here is a real container: it knows what is inside it, it moves what is
 * inside it, it can be collapsed to a single chip, and it can be opened on its own
 * — a canvas within a canvas — so a section can be worked on at the size of a
 * screen instead of the size of the board.
 *
 * ── WHY MEMBERSHIP IS GEOMETRIC AND NOT A STORED LIST ────────────────────────
 * Containment is decided by where things ARE: an object belongs to a frame when
 * its centre is inside that frame's rectangle. The alternative — a `members: []`
 * array on the frame, or a `frameId` on each object — is a second source of truth
 * for something the board already shows, and it drifts the first time anything
 * moves an object without going through the "join a frame" code path (a nudge, an
 * arrange, a Brain patch, an import, a merge). Geometry cannot drift, because it
 * IS what the person is looking at.
 *
 * The trade is that a frame cannot own something drawn outside it, which is the
 * correct answer to a question nobody asks: a bounding box that contains something
 * it does not enclose is not a bounding box.
 *
 * ── WHY THE SMALLEST ENCLOSING FRAME OWNS ────────────────────────────────────
 * Frames nest (a flow inside a phase inside a release). An object inside two
 * frames belongs to the inner one, so collapsing the outer one takes the inner one
 * and everything in it, and collapsing the inner one leaves the outer one intact.
 *
 * Pure functions over plain rectangles — no React, no React Flow, no store. The
 * canvas owns the drag glue and the rendering; this module owns the meaning.
 */

/** The kind every frame object carries. */
export const FRAME_KIND = 'frame';

/** What a frame is created at, and what an expanded one falls back to. */
export const FRAME_DEFAULT_SIZE = { width: 720, height: 460 } as const;
/** What a collapsed frame shrinks to — a chip that names the section and counts it. */
export const FRAME_COLLAPSED_SIZE = { width: 320, height: 92 } as const;

export interface FrameBox {
  id: string;
  kind: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: Record<string, unknown>;
}

export interface FrameRect { x: number; y: number; width: number; height: number }

/** Whether this object is a frame at all. */
export function isFrame(box: Pick<FrameBox, 'kind'>): boolean {
  return box.kind === FRAME_KIND;
}

/** Whether a frame is currently put away. */
export function isFrameCollapsed(data: Record<string, unknown>): boolean {
  return data.frameCollapsed === true;
}

export function frameRect(box: FrameBox): FrameRect {
  return { x: box.position.x, y: box.position.y, width: box.size.width, height: box.size.height };
}

function centreOf(box: FrameBox): { x: number; y: number } {
  return { x: box.position.x + box.size.width / 2, y: box.position.y + box.size.height / 2 };
}

function contains(rect: FrameRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function area(rect: FrameRect): number {
  return Math.max(1, rect.width) * Math.max(1, rect.height);
}

/**
 * Object id → the id of the frame that owns it, for every owned object.
 *
 * A frame may itself be owned (frames nest); a frame never owns itself, and a
 * collapsed frame's rectangle is its COLLAPSED one, so an object left behind at
 * the old coordinates does not silently rejoin a frame that has been put away.
 * That is why {@link frameOwners} is computed from the boxes as they are drawn.
 */
export function frameOwners(boxes: readonly FrameBox[]): Map<string, string> {
  const frames = boxes.filter(isFrame);
  const owners = new Map<string, string>();
  if (frames.length === 0) return owners;
  for (const box of boxes) {
    const centre = centreOf(box);
    let best: { id: string; size: number } | null = null;
    for (const frame of frames) {
      if (frame.id === box.id) continue;
      const rect = frameRect(frame);
      if (!contains(rect, centre)) continue;
      const size = area(rect);
      if (!best || size < best.size) best = { id: frame.id, size };
    }
    if (best) owners.set(box.id, best.id);
  }
  return owners;
}

/** Everything a frame owns, directly or through a nested frame. */
export function frameMemberIds(frameId: string, boxes: readonly FrameBox[]): string[] {
  const owners = frameOwners(boxes);
  return boxes.filter((box) => box.id !== frameId && ownerChain(box.id, owners).includes(frameId)).map((box) => box.id);
}

/** The frames enclosing an object, innermost first. */
function ownerChain(id: string, owners: ReadonlyMap<string, string>): string[] {
  const chain: string[] = [];
  let current = owners.get(id);
  // Bounded by the number of frames: `frameOwners` only ever nominates a STRICTLY
  // smaller enclosing frame, so the chain cannot cycle.
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = owners.get(current);
  }
  return chain;
}

/**
 * The objects a collapsed frame is currently hiding.
 *
 * A frame nested inside a collapsed frame is hidden along with everything IT
 * owns, whether or not it is itself collapsed — which is what makes "put this
 * section away" mean the section rather than its first layer.
 */
export function hiddenByCollapsedFrames(boxes: readonly FrameBox[]): Set<string> {
  const collapsed = new Set(boxes.filter((box) => isFrame(box) && isFrameCollapsed(box.data)).map((box) => box.id));
  if (collapsed.size === 0) return new Set();
  const owners = frameOwners(boxes);
  const hidden = new Set<string>();
  for (const box of boxes) {
    if (collapsed.has(box.id)) continue;
    if (ownerChain(box.id, owners).some((frameId) => collapsed.has(frameId))) hidden.add(box.id);
  }
  return hidden;
}

/**
 * Where a connection to a hidden object should be drawn INSTEAD.
 *
 * A step inside a collapsed frame still has upstream and downstream work, and an
 * edge that simply disappears with it reads as a flow that stops there. So the
 * edge is re-pointed at the outermost collapsed frame hiding it: the picture stays
 * a connected flow, at the resolution the reader asked for.
 */
export function visibleEndpoint(id: string, boxes: readonly FrameBox[], hidden: ReadonlySet<string>): string {
  if (!hidden.has(id)) return id;
  const collapsed = new Set(boxes.filter((box) => isFrame(box) && isFrameCollapsed(box.data)).map((box) => box.id));
  const chain = ownerChain(id, frameOwners(boxes));
  // Outermost, so two steps inside the same put-away section resolve to the same
  // chip rather than to two nested ones.
  const enclosing = chain.filter((frameId) => collapsed.has(frameId));
  return enclosing[enclosing.length - 1] ?? id;
}

/**
 * The size a frame should be drawn at, and the size to restore it to.
 *
 * The expanded size is remembered on the object rather than recomputed, because a
 * frame the author sized by hand is an authored fact — recomputing it from its
 * contents on every expand would quietly undo their layout.
 */
export function frameCollapsePatch(box: FrameBox, collapsed: boolean): {
  data: Record<string, unknown>;
  size: { width: number; height: number };
} {
  if (collapsed) {
    return {
      data: {
        frameCollapsed: true,
        frameExpandedWidth: box.size.width,
        frameExpandedHeight: box.size.height,
      },
      size: { ...FRAME_COLLAPSED_SIZE },
    };
  }
  const width = Number(box.data.frameExpandedWidth);
  const height = Number(box.data.frameExpandedHeight);
  return {
    data: { frameCollapsed: false },
    size: {
      width: Number.isFinite(width) && width > 0 ? width : FRAME_DEFAULT_SIZE.width,
      height: Number.isFinite(height) && height > 0 ? height : FRAME_DEFAULT_SIZE.height,
    },
  };
}

/** The rectangle that encloses these boxes, plus breathing room. */
export function boundingRect(boxes: readonly FrameBox[], padding: number): FrameRect {
  if (boxes.length === 0) return { x: 0, y: 0, width: FRAME_DEFAULT_SIZE.width, height: FRAME_DEFAULT_SIZE.height };
  const left = Math.min(...boxes.map((box) => box.position.x)) - padding;
  const top = Math.min(...boxes.map((box) => box.position.y)) - padding;
  const right = Math.max(...boxes.map((box) => box.position.x + box.size.width)) + padding;
  const bottom = Math.max(...boxes.map((box) => box.position.y + box.size.height)) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
