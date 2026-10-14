/**
 * Frustration detectors — the ONE set of thresholds every surface uses (PRD 33 §3.4).
 *
 * Rage, dead click, quick back and excessive scroll are product language, not
 * per-view heuristics. The recorder marks a visit with them, ingest folds the
 * marks into issues, and Insights filters on them; nobody keeps a second
 * definition.
 *
 * Pure: no DOM globals. Dead-click candidacy reads the same structural
 * `SelectorElement` the selector rule uses.
 */

import { implicitRole, type SelectorElement } from './selector';

export const FRUSTRATION_THRESHOLDS = {
  /** ≥3 clicks inside 700 ms, each within 30 px of the latest. */
  rage: { minClicks: 3, windowMs: 700, radiusPx: 30 },
  /** A non-interactive click followed by no navigation and no DOM mutation for 500 ms. */
  dead: { waitMs: 500 },
  /** The last three pages are A→B→A and the visitor stayed on B under 7 s. */
  quickBack: { maxDwellMs: 7_000 },
  /**
   * ≥3 direction reversals inside 5 s, or more than 3 viewport heights of
   * scrolling inside 10 s with no click in that window.
   */
  excessiveScroll: { reversals: 3, reversalWindowMs: 5_000, viewportHeights: 3, travelWindowMs: 10_000 },
} as const;

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'option', 'details', 'label']);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch',
  'textbox', 'combobox', 'slider', 'spinbutton', 'searchbox', 'option', 'listbox',
]);

function isInteractive(el: SelectorElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = (el.getAttribute('role') ?? implicitRole(el) ?? '').toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el.getAttribute('contenteditable') ?? '').toLowerCase() === 'true') return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  if (el.getAttribute('onclick')) return true;
  if (el.getAttribute('href')) return true;
  return false;
}

/**
 * A click that landed on an element that does not look interactive — neither
 * it nor any ancestor is a control, link, ARIA widget, editable region or
 * carries a click-handler hint. The recorder still waits
 * `FRUSTRATION_THRESHOLDS.dead.waitMs` for a navigation or DOM mutation
 * before it marks the click dead.
 */
export function isDeadClickCandidate(el: SelectorElement): boolean {
  let node: SelectorElement | null = el;
  let depth = 0;
  while (node && depth < 8) {
    if (isInteractive(node)) return false;
    node = node.parentElement;
    depth += 1;
  }
  return true;
}

export interface PointerSample {
  /** ms, any monotonic clock shared by the samples. */
  t: number;
  x: number;
  y: number;
}

/**
 * Whether the LATEST click completes a rage burst: at least `minClicks`
 * clicks (the latest included) inside `windowMs` before it and within
 * `radiusPx` of it. `recent` is in arrival order.
 */
export function isRageClick(
  recent: ReadonlyArray<PointerSample>,
  opts: { minClicks?: number; windowMs?: number; radiusPx?: number } = {},
): boolean {
  const minClicks = opts.minClicks ?? FRUSTRATION_THRESHOLDS.rage.minClicks;
  const windowMs = opts.windowMs ?? FRUSTRATION_THRESHOLDS.rage.windowMs;
  const radiusPx = opts.radiusPx ?? FRUSTRATION_THRESHOLDS.rage.radiusPx;
  if (recent.length < minClicks) return false;
  const last = recent[recent.length - 1]!;
  const r2 = radiusPx * radiusPx;
  let n = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const sample = recent[i]!;
    if (last.t - sample.t > windowMs) break;
    const dx = sample.x - last.x;
    const dy = sample.y - last.y;
    if (dx * dx + dy * dy <= r2) n += 1;
  }
  return n >= minClicks;
}

export interface PageSample {
  path: string;
  /** ms when the page was entered. */
  t: number;
}

/**
 * A→B→A over the LAST three page entries, with the stay on B shorter than
 * `maxDwellMs`. Earlier history is ignored, so the same bounce is reported
 * once, when it happens.
 */
export function isQuickBack(
  pages: ReadonlyArray<PageSample>,
  opts: { maxDwellMs?: number } = {},
): boolean {
  const maxDwellMs = opts.maxDwellMs ?? FRUSTRATION_THRESHOLDS.quickBack.maxDwellMs;
  if (pages.length < 3) return false;
  const a = pages[pages.length - 3]!;
  const b = pages[pages.length - 2]!;
  const c = pages[pages.length - 1]!;
  if (a.path !== c.path || a.path === b.path) return false;
  const dwell = c.t - b.t;
  return dwell >= 0 && dwell < maxDwellMs;
}

export interface ScrollSample {
  t: number;
  /** Vertical scroll offset in px. */
  y: number;
}

/**
 * Excessive scrolling, judged at the latest sample:
 * - ≥ `reversals` direction changes inside the last `reversalWindowMs`; or
 * - more than `viewportHeights` × `viewportH` px of scrolling inside the last
 *   `travelWindowMs`, with no click in that window (`lastClickT` null = no
 *   click yet).
 */
export function isExcessiveScroll(
  samples: ReadonlyArray<ScrollSample>,
  viewportH: number,
  lastClickT: number | null,
  opts: { reversals?: number; reversalWindowMs?: number; viewportHeights?: number; travelWindowMs?: number } = {},
): boolean {
  const t = FRUSTRATION_THRESHOLDS.excessiveScroll;
  const reversalsNeeded = opts.reversals ?? t.reversals;
  const reversalWindowMs = opts.reversalWindowMs ?? t.reversalWindowMs;
  const viewportHeights = opts.viewportHeights ?? t.viewportHeights;
  const travelWindowMs = opts.travelWindowMs ?? t.travelWindowMs;
  if (samples.length < 2) return false;
  const now = samples[samples.length - 1]!.t;

  let reversals = 0;
  let prevSign = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const dy = cur.y - prev.y;
    const sign = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (sign === 0) continue;
    if (prevSign !== 0 && sign !== prevSign && now - cur.t <= reversalWindowMs) reversals += 1;
    prevSign = sign;
  }
  if (reversals >= reversalsNeeded) return true;

  const windowStart = now - travelWindowMs;
  if (lastClickT !== null && lastClickT >= windowStart) return false;
  if (!(viewportH > 0)) return false;
  let travel = 0;
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i]!;
    if (cur.t < windowStart) continue;
    travel += Math.abs(cur.y - samples[i - 1]!.y);
  }
  return travel > viewportHeights * viewportH;
}
