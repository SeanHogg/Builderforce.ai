/**
 * Which bucket a route falls into — the classifier that replaces "every route is
 * a page that replaces the screen".
 *
 * Three buckets, and a route declares its bucket by SHAPE rather than by being
 * listed in a central map that becomes a six-hundred-line file nobody reviews:
 *
 *  - `stage`      — the board itself. The route sets active-canvas state and
 *                   renders nothing, so switching between canvas modes no longer
 *                   remounts the board.
 *  - `workbench`  — an operational page. It opens OVER the board as a panel
 *                   instead of replacing it, so "show me the runway" no longer
 *                   costs you the thing you were building. PRD 21 §3.4 fixes the
 *                   panel's width to one of three; {@link panelWidth} decides
 *                   which, here, so a route cannot invent a fourth.
 *  - `standalone` — marketing, auth, framed embeds, public browse, the restricted
 *                   gig shell. Unchanged: they keep their own chrome, and an
 *                   external viewer must never see the operator shell.
 *
 * Pure, so the buckets are a unit-testable table rather than emergent behaviour.
 */

import { classifyShell } from './shellRouting';

export type RouteBucket = 'stage' | 'workbench' | 'standalone';

/**
 * Canvas surfaces. Each is a MODE of one stage rather than its own component
 * tree — which is the reason this list can grow (PRD 18 brings more runtimes)
 * without the stage being rebuilt per runtime.
 */
const STAGE_PATTERNS: RegExp[] = [
  /^\/create\/[^/]+/,
  /^\/brainstorm(?:\/|$)/,
  /^\/workflows\/builder(?:\/|$)/,
];

/**
 * App-shell routes that still own the whole screen. A single Project keeps its
 * dedicated editor for now; build workspaces are opened from Canvas objects.
 */
const FULL_WIDTH_PATTERNS: RegExp[] = [
  /^\/projects\/[^/]+$/,
  /^\/freelancer(?:\/|$)/,
  /^\/sales(?:\/|$)/,
];

/** True when this route puts a board on the stage rather than rendering a page. */
export function isStageRoute(pathname: string): boolean {
  return STAGE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function classifyRoute(pathname: string): RouteBucket {
  // Anything outside the operator shell keeps its own chrome, by definition.
  if (classifyShell(pathname) !== 'app') return 'standalone';
  if (isStageRoute(pathname)) return 'stage';
  if (FULL_WIDTH_PATTERNS.some((pattern) => pattern.test(pathname))) return 'standalone';
  return 'workbench';
}

/**
 * Should the panel be open right now?
 *
 * The panel exists to keep the board while you consult a page — so with no board
 * there is nothing to keep, and the page takes the screen exactly as it does
 * today. That is what makes this change free for anyone who never opens a canvas.
 */
export function panelOpen(pathname: string, hasActiveCanvas: boolean): boolean {
  return hasActiveCanvas && classifyRoute(pathname) === 'workbench';
}

/**
 * Which of the three widths a destination opens at (PRD 21 §3.4).
 *
 *   sheet — your own account: settings, profile, security, pricing.
 *   full  — a dashboard that needs the room; the board is one Esc away.
 *   wide  — everything else: an index beside a detail.
 *
 * A pure table rather than a `width` prop at each call site, because a prop is
 * how the documented three-step scale became twenty distinct panel widths.
 */
const SHEET_PATTERNS: RegExp[] = [
  /^\/settings(?:\/|$)/,
  /^\/security(?:\/|$)/,
  /^\/pricing(?:\/|$)/,
  /^\/profile(?:\/|$)/,
];

const FULL_PATTERNS: RegExp[] = [
  /^\/insights(?:\/|$)/,
  /^\/dashboards(?:\/|$)/,
  /^\/finops(?:\/|$)/,
  /^\/admin(?:\/|$)/,
  /^\/seat(?:\/|$)/,
];

export function panelWidth(pathname: string): 'sheet' | 'wide' | 'full' {
  if (SHEET_PATTERNS.some((pattern) => pattern.test(pathname))) return 'sheet';
  if (FULL_PATTERNS.some((pattern) => pattern.test(pathname))) return 'full';
  return 'wide';
}
