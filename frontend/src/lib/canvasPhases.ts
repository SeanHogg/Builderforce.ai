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
 * computed today. A canvas's own phase is a narrower, per-CANVAS choice: which stage
 * of ITS OWN arc the person working on it says they are in, remembered under a key
 * carrying the session id — a place someone chose, not a fact derived from company
 * records. With no choice remembered, the canvas opens at its FRONTIER — the first
 * phase whose own output is not on the board yet (`lib/canvasPhaseReadiness.ts`) —
 * because defaulting a live canvas to Idea is wrong. The two concepts share a vocabulary (`nav.stage.*`,
 * the `--stage-*` tokens) because they name the same five words, not because one is
 * computed from the other.
 *
 * ── THE PHASES ARE THE ARC ────────────────────────────────────────────────────────
 * `CANVAS_PHASES` IS `ARC_STAGES` (navGroups.ts), the same five the method, the panel
 * header and the Product ▾ menu show. A new stage is added there, plus an entry in
 * `PHASE_SURFACES` naming what it unlocks (a superset of the phase before it — see
 * the comment there for why this never removes a surface).
 */

import { ARC_STAGES, type ArcStage } from './navGroups';
import type { CanvasSurfaceId } from './canvasSurfaces';
import { readLocal, removeLocal, writeLocal } from './storage';

export type CanvasPhase = ArcStage;

/** Declaration order is display order, same convention as `CANVAS_SURFACES`. */
export const CANVAS_PHASES: readonly CanvasPhase[] = ARC_STAGES;

/**
 * Which board surfaces a phase offers.
 *
 * Additive, not exclusive: `chat`, `graph` and `room` are in EVERY phase — they predate
 * this registry (the room absorbed the "3D space" entry that did), a visitor has always
 * been able to reach all three regardless of what the session is "for", and taking one
 * away the moment a phase changes would be a real capability lost, not a tidier tab row.
 *
 * `app` starts at MAKE, not Idea. The additive rule is an argument for KEEPING App once
 * it has appeared — a session that built an app in Make and moved on to Measure still has
 * that app, and hiding it the moment metrics appear would take away the very thing being
 * measured — but it is no argument for offering it BEFORE there is anything to build. In
 * Idea, App can only open "Start this session's app", which invites building before the
 * idea is tested. A prototype used to test demand is an `experiment` card on the board,
 * linked through `testedBy`, not the App surface.
 *
 * `operate` arrives at Run (what is deployed, released and running) and `launch` at Reach
 * (the Make-it-real doors laid out as a place). Both are compositions of panels that
 * already exist — see `CanvasOperateSurface` and `CanvasLaunchSurface`.
 *
 * `insights` is the one surface this registry actually gates: it is new, it has
 * nothing to show before a session has something worth measuring, and offering it
 * from Idea would be a tab that opens to an empty pinned-widgets list every time. It
 * appears starting at Measure — the phase whose whole question is "what is this
 * worth" — and stays offered in Reach, same as everything else that has ever
 * appeared.
 *
 * `room` is offered in EVERY phase, and it is worth saying why it is not gated the
 * way `insights` is. The two look similar — both new, both about something a young
 * session may not have yet — but they fail differently when they are empty. An
 * Insights tab with nothing pinned shows a reader nothing and can show nothing,
 * because the data does not exist. A room with one person in it is a room with one
 * person in it: correct, legible, and exactly what a workshop looks like ten seconds
 * before the second person arrives. Gating a MEETING by which stage of the method a
 * board says it is in would also be the wrong shape of rule — two people wanting to
 * talk about an idea is the case for the room, not an argument against it.
 *
 * `ideas` — the idea scratchpad — is offered from Idea onward, i.e. in EVERY phase.
 * It IS the Idea phase's surface, so the first phase must offer it; and by the
 * additive rule above it never disappears later — a founder in Run still has new
 * ideas to jot, and the list of what was tested is part of what Measure reads. It
 * shipped missing from this map, which is why it registered as a surface and never
 * appeared in the header: the switcher offers only what this map allows.
 */
const PHASE_SURFACES: Readonly<Record<CanvasPhase, readonly CanvasSurfaceId[]>> = {
  idea: ['chat', 'graph', 'ideas', 'room'],
  make: ['chat', 'graph', 'ideas', 'room', 'app'],
  run: ['chat', 'graph', 'ideas', 'room', 'app', 'operate'],
  measure: ['chat', 'graph', 'ideas', 'room', 'app', 'operate', 'insights'],
  reach: ['chat', 'graph', 'ideas', 'room', 'app', 'operate', 'insights', 'launch'],
};

export function surfacesForPhase(phase: CanvasPhase): readonly CanvasSurfaceId[] {
  return PHASE_SURFACES[phase];
}

/** What a phase OFFERS that the phase before it did not — the "adds App" line on the
 *  phone's phase sheet. The first phase adds everything it offers. */
export function surfacesAddedByPhase(phase: CanvasPhase): readonly CanvasSurfaceId[] {
  const index = CANVAS_PHASES.indexOf(phase);
  const before = index > 0 ? new Set(PHASE_SURFACES[CANVAS_PHASES[index - 1]!]) : new Set<CanvasSurfaceId>();
  return PHASE_SURFACES[phase].filter((id) => !before.has(id));
}

const PHASE_SET = new Set<string>(CANVAS_PHASES);

export function isCanvasPhase(value: unknown): value is CanvasPhase {
  return typeof value === 'string' && PHASE_SET.has(value);
}

/** The legacy GLOBAL key — one phase per browser, so Measure on one canvas put every
 *  other canvas in Measure too. Never read; deleted on the first per-canvas write. */
const LEGACY_CANVAS_PHASE_STORAGE_KEY = 'builderforce:create:phase';

/** Where a canvas's chosen phase is remembered: per CANVAS, never per browser. */
export function canvasPhaseStorageKey(sessionId: string): string {
  return `${LEGACY_CANVAS_PHASE_STORAGE_KEY}:${sessionId}`;
}

/** The phase someone actually CHOSE for this canvas, or undefined when none ever was.
 *  Undefined is an answer, not a gap: the canvas then defaults to its frontier
 *  (`frontierPhase`), and a run launched from it must not report "idea" as if someone
 *  had said so — which is what reading through a default would do. */
export function readChosenCanvasPhase(sessionId: string): CanvasPhase | undefined {
  const stored = readLocal(canvasPhaseStorageKey(sessionId));
  return isCanvasPhase(stored) ? stored : undefined;
}

export function writeCanvasPhase(phase: CanvasPhase, sessionId: string): void {
  writeLocal(canvasPhaseStorageKey(sessionId), phase);
  // The global key was never per-canvas truth, so it is dropped rather than migrated.
  removeLocal(LEGACY_CANVAS_PHASE_STORAGE_KEY);
}
