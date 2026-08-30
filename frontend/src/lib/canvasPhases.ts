/**
 * Canvas phases — WHERE IN THE METHODOLOGY this session is, and what that unlocks.
 *
 * `canvasSurfaces.ts` answers "how is this board read?". This answers a question one
 * level up: "what is this session FOR, right now?" — and the answer changes which
 * surfaces are worth offering. A brand-new idea has no app to run and nothing to
 * measure; a session in Measure has metrics to read and nothing left to sketch. Every
 * surface stays reachable somewhere in the arc — this never locks a person OUT of a
 * capability once it has appeared, only decides when it first becomes worth the tab.
 *
 * ── WHY THIS IS NOT `useFounderJourney()` ────────────────────────────────────────
 * That hook (`lib/useFounderJourney.ts`) answers "where is this TENANT" from data that
 * already exists — no field anywhere stores it, and only `idea`/`run` are even
 * computed today. A canvas's own phase is a narrower, per-session choice: which stage
 * of ITS OWN arc the person working on it says they are in, remembered the same way
 * `canvasSurfaces.ts` remembers the surface — a place someone chose, not a fact
 * derived from company records. The two concepts share a vocabulary (`nav.stage.*`,
 * the `--stage-*` tokens) because they name the same five words, not because one is
 * computed from the other.
 *
 * ── WHY REACH IS HERE AND `METHOD_STAGES` STOPS AT MEASURE ──────────────────────
 * `lib/methodology.ts`'s `METHOD_STAGES` is a deliberate four-stage SUBSET for a
 * one-paragraph marketing pitch — "somebody deciding whether to start" never asks
 * about distribution yet. A person already working a canvas has moved past that
 * pitch, and asking a board in Reach to offer Insights is exactly the case this
 * registry exists for. So this list is its own five, not an import of that four.
 *
 * ── ADDING A PHASE ────────────────────────────────────────────────────────────────
 *   1. an entry in `CANVAS_PHASES`,
 *   2. an entry in `PHASE_SURFACES` naming what it unlocks (a superset of the phase
 *      before it — see the comment there for why this never removes a surface).
 * `nav.stage.<id>` already exists in all five catalogs for every `Stage` value, so a
 * new phase needs no new copy as long as it names an existing stage.
 */

import type { Stage } from './navGroups';
import type { CanvasSurfaceId } from './canvasSurfaces';

export type CanvasPhase = Extract<Stage, 'idea' | 'make' | 'run' | 'measure' | 'reach'>;

/** Declaration order is display order, same convention as `CANVAS_SURFACES`. */
export const CANVAS_PHASES: readonly CanvasPhase[] = ['idea', 'make', 'run', 'measure', 'reach'];

export const DEFAULT_CANVAS_PHASE: CanvasPhase = 'idea';

/**
 * Which board surfaces a phase offers.
 *
 * Additive, not exclusive: `chat`, `graph`, `scene3d` and `app` are in EVERY phase —
 * they predate this registry, a visitor has always been able to reach all four
 * regardless of what the session is "for", and taking one away the moment a phase
 * changes would be a real capability lost, not a tidier tab row. A session that built
 * an app in Make and moved on to Measure still has that app — hiding `app` the moment
 * metrics appear would take away the very thing being measured.
 *
 * `insights` is the one surface this registry actually gates: it is new, it has
 * nothing to show before a session has something worth measuring, and offering it
 * from Idea would be a tab that opens to an empty pinned-widgets list every time. It
 * appears starting at Measure — the phase whose whole question is "what is this
 * worth" — and stays offered in Reach, same as everything else that has ever
 * appeared.
 */
const PHASE_SURFACES: Readonly<Record<CanvasPhase, readonly CanvasSurfaceId[]>> = {
  idea: ['chat', 'graph', 'scene3d', 'app'],
  make: ['chat', 'graph', 'scene3d', 'app'],
  run: ['chat', 'graph', 'scene3d', 'app'],
  measure: ['chat', 'graph', 'scene3d', 'app', 'insights'],
  reach: ['chat', 'graph', 'scene3d', 'app', 'insights'],
};

export function surfacesForPhase(phase: CanvasPhase): readonly CanvasSurfaceId[] {
  return PHASE_SURFACES[phase];
}

const PHASE_SET = new Set<string>(CANVAS_PHASES);

export function isCanvasPhase(value: unknown): value is CanvasPhase {
  return typeof value === 'string' && PHASE_SET.has(value);
}

export function sanitizeCanvasPhase(value: unknown): CanvasPhase {
  return isCanvasPhase(value) ? value : DEFAULT_CANVAS_PHASE;
}

export const CANVAS_PHASE_STORAGE_KEY = 'builderforce:create:phase';

/** Same persistence shape as `readCanvasSurface`: a place someone chose, remembered
 *  per browser, degrading to the default rather than throwing on a stale value. */
export function readCanvasPhase(): CanvasPhase {
  if (typeof window === 'undefined') return DEFAULT_CANVAS_PHASE;
  try {
    return sanitizeCanvasPhase(window.localStorage.getItem(CANVAS_PHASE_STORAGE_KEY));
  } catch {
    return DEFAULT_CANVAS_PHASE;
  }
}

export function writeCanvasPhase(phase: CanvasPhase): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CANVAS_PHASE_STORAGE_KEY, phase);
  } catch {
    // Storage can be unavailable in hardened contexts — nothing to recover to.
    return;
  }
}
