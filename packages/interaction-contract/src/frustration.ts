/**
 * Frustration detectors — the ONE set of thresholds every surface uses.
 *
 * Rage, dead-click, quick-back and excessive-scroll are product language, not
 * per-view heuristics. The recorder marks a visit with them, Insights filters
 * on them, and the QA heat ranking must not invent a second definition.
 *
 * Pure: no DOM globals. Dead-click candidacy reads the same structural
 * `SelectorElement` the selector rule uses.
 */

import { implicitRole, type SelectorElement } from './selector';

export const FRUSTRATION_THRESHOLDS = {
  rage: { windowMs: 3_000, radiusPx: 24, minClicks: 3 },
  deadClick: { waitMs: 500 },
  quickBack: { windowMs: 7_000 },
  excessiveScroll: {
    reversals: 3,
    reversalWindowMs: 5_000,
    viewportHeights: 3,
    heightWindowMs: 10_000,
  },
} as const;

const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'option',
  'details',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'switch',
  'textbox',
  'combobox',
  'slider',
  'spinbutton',
  'searchbox',
  'option',
  'listbox',
]);

/**
 * Whether an element is (or looks) interactive — tags, implicit/explicit
 * ARIA role, contenteditable, tabindex, or a click-handler hint (`onclick`
 * / `href`). Dead-click candidacy is the inverse.
 */
export function isInteractiveElement(el: SelectorElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = (el.getAttribute('role') ?? implicitRole(el) ?? '').toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el.getAttribute('contenteditable') ?? '').toLowerCase() === 'true') return true;
  const ti = el.getAttribute('tabindex');
  if (ti !== null && Number(ti) >= 0) return true;
  if (el.getAttribute('onclick')) return true;
  if (el.getAttribute('href')) return true;
  return false;
}

/** A click that landed on a non-interactive element with no click-handler hint. */
export function isDeadClickCandidate(el: SelectorElement): boolean {
  return !isInteractiveElement(el);
}

export interface PointerSample {
  t: number;
  x: number;
  y: number;
}

/**
 * Three or more clicks inside 3 s and 24 px of each other. `clicks` need not
 * be sorted; a copy is ordered by `t`.
 */
export function isRageClick(
  clicks: ReadonlyArray<PointerSample>,
  opts: { windowMs?: number; radiusPx?: number; minClicks?: number } = {},
): boolean {
  const windowMs = opts.windowMs ?? FRUSTRATION_THRESHOLDS.rage.windowMs;
  const radiusPx = opts.radiusPx ?? FRUSTRATION_THRESHOLDS.rage.radiusPx;
  const minClicks = opts.minClicks ?? FRUSTRATION_THRESHOLDS.rage.minClicks;
  if (clicks.length < minClicks) return false;
  const ordered = clicks.slice().sort((a, b) => a.t - b.t);
  const r2 = radiusPx * radiusPx;
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    let n = 1;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      if (b.t - a.t > windowMs) break;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy <= r2) n += 1;
      if (n >= minClicks) return true;
    }
  }
  return false;
}

export interface PageSample {
  path: string;
  t: number;
}

/**
 * A→B→A where the return to A happened within 7 s of leaving it
 * (i.e. of arriving at B).
 */
export function isQuickBack(
  pages: ReadonlyArray<PageSample>,
  windowMs: number = FRUSTRATION_THRESHOLDS.quickBack.windowMs,
): boolean {
  if (pages.length < 3) return false;
  for (let i = 2; i < pages.length; i++) {
    const a = pages[i - 2]!;
    const b = pages[i - 1]!;
    const c = pages[i]!;
    if (a.path === c.path && a.path !== b.path && c.t - b.t <= windowMs) return true;
  }
  return false;
}

export interface ScrollSample {
  t: number;
  y: number;
}

/**
 * Either ≥3 direction reversals inside 5 s, or ≥3 viewport-heights of
 * travel inside 10 s. `viewportHeight` defaults to 800 so the height
 * check is well-defined without a window.
 */
export function isExcessiveScroll(
  samples: ReadonlyArray<ScrollSample>,
  opts: {
    reversals?: number;
    windowMs?: number;
    viewportHeights?: number;
    heightWindowMs?: number;
    viewportHeight?: number;
  } = {},
): boolean {
  const reversalsNeeded = opts.reversals ?? FRUSTRATION_THRESHOLDS.excessiveScroll.reversals;
  const reversalWindowMs = opts.windowMs ?? FRUSTRATION_THRESHOLDS.excessiveScroll.reversalWindowMs;
  const vhNeeded = opts.viewportHeights ?? FRUSTRATION_THRESHOLDS.excessiveScroll.viewportHeights;
  const heightWindowMs = opts.heightWindowMs ?? FRUSTRATION_THRESHOLDS.excessiveScroll.heightWindowMs;
  const viewportHeight = opts.viewportHeight ?? 800;
  if (samples.length < 2) return false;
  const ordered = samples.slice().sort((a, b) => a.t - b.t);

  const turns: number[] = [];
  let prevSign = 0;
  for (let i = 1; i < ordered.length; i++) {
    const dy = ordered[i]!.y - ordered[i - 1]!.y;
    const sign = dy === 0 ? 0 : dy > 0 ? 1 : -1;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      turns.push(ordered[i]!.t);
      if (countInWindow(turns, reversalWindowMs) >= reversalsNeeded) return true;
    }
    if (sign !== 0) prevSign = sign;
  }

  const travel = vhNeeded * viewportHeight;
  let lo = 0;
  let minY = ordered[0]!.y;
  let maxY = ordered[0]!.y;
  for (let hi = 0; hi < ordered.length; hi++) {
    const tHi = ordered[hi]!.t;
    while (lo < hi && tHi - ordered[lo]!.t > heightWindowMs) lo += 1;
    minY = Infinity;
    maxY = -Infinity;
    for (let k = lo; k <= hi; k++) {
      const y = ordered[k]!.y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxY - minY >= travel) return true;
  }
  return false;
}

function countInWindow(times: readonly number[], windowMs: number): number {
  const last = times[times.length - 1]!;
  let n = 0;
  for (let i = times.length - 1; i >= 0; i--) {
    if (last - times[i]! > windowMs) break;
    n += 1;
  }
  return n;
}
