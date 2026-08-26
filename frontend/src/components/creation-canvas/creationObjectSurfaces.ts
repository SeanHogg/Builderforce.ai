import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CreationObjectKind } from './types';

/**
 * The join between the canvas's two extensibility axes: which SURFACE authors which KIND.
 *
 * Kinds answer "what is this thing?" (`creationObjectRegistry.ts`, spec data). Surfaces
 * answer "how is this read?" (`lib/canvasSurfaces.ts`, spec data). This is the one place
 * the two meet, and it lives beside neither of them on purpose — the object registry does
 * not need to know that surfaces exist to define an object, and the surface registry
 * cannot know about object kinds without inverting its dependency.
 *
 * ── WHY MOST KINDS ARE ABSENT, AND SHOULD STAY ABSENT ────────────────────────────
 * A node body is a card, and a card is the right size to PREVIEW anything and the wrong
 * size for a medium's own axis: a résumé has a page, a build has a running frame, an edit
 * has a second track. Those do not fit in ~340px, which is why each of these kinds already
 * had an editor crammed into one before a surface existed to hold it.
 *
 * Absent means "the card IS the object" — a note, a task, a metric, a sticky. That is the
 * majority and the default. A surface is for a medium with a dimension the board cannot
 * draw, never for a kind that would merely enjoy more room; adding one here for the latter
 * is how a canvas turns into a folder of full-screen editors.
 */
const AUTHORING_SURFACE: Partial<Record<CreationObjectKind, CanvasSurfaceId>> = {
  // A page. The `DOCUMENT_BODY_KINDS` set, plus the résumé — the same paper with a schema.
  document: 'page', prd: 'page', knowledge: 'page', resume: 'page',
  // A running build. Already a full-surface runtime before this existed; it just wore a
  // bespoke `gameFocus` boolean instead of a surface id.
  game: 'play',
  // Pages you move between, at a width you pick. A prototype is the same object earlier
  // in its life — same `pages[]`, same theme, same sections — so it reads the same way.
  website: 'site', prototype: 'site',
  // Time. Both kinds persist a `CanvasVideoTimeline`, which is tracks × seconds.
  video: 'timeline', voice: 'timeline',
  // A place: camera, props, colliders. No card can preview a space you walk through,
  // any more than one previews a running build — same reason `game` opens in `play`.
  world: 'world',
  // AI VIDEO/3D GENERATION. Deliberately `scene3d` and not `timeline`: the product
  // decision is that generation lives under the 3D surface, which forks on whether a
  // `scene` object is bound (`CreationCanvas.tsx`'s `surfaces` map) rather than
  // growing a conditional inside `Canvas3DView` itself. `video`/`voice` above are
  // untouched — this is purely additive.
  scene: 'scene3d',
  // A room. A poll's own axis is the people answering it: the join address goes on the
  // wall, the count moves while they answer, and the two facilitation controls are
  // pressed in front of them. A card can preview the question; it cannot be the thing a
  // workshop is RUN from.
  poll: 'facilitate',
  // A month, a week and a day, with an hour grid and a detail panel. It is here rather
  // than in the rail because a calendar is a THING you can have several of — a release
  // calendar beside a send calendar beside the team's leave — and a rail entry is a mode
  // you can only be in one of. The card previews the month; this opens it at full size.
  calendar: 'calendar',
};

/**
 * Which surface opens this object full-size, or `null` when the card is the whole object.
 *
 * Consumers read this instead of listing kinds, which is what makes "open at full size"
 * appear exactly where there is something to open — see `CanvasObjectSurfaceButton`, which
 * renders nothing at all when this returns null rather than taking a `canOpen` boolean
 * somebody else computed.
 */
export function creationObjectSurface(kind: CreationObjectKind): CanvasSurfaceId | null {
  return AUTHORING_SURFACE[kind] ?? null;
}
