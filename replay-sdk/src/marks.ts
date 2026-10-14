/**
 * Mark derivation — page, click, rage, dead, quick back, excessive scroll,
 * scroll depth. The thresholds and detectors are the contract's
 * (`FRUSTRATION_THRESHOLDS`); this file only feeds them samples and shapes
 * the marks.
 */

import {
  FRUSTRATION_THRESHOLDS,
  isDeadClickCandidate,
  isExcessiveScroll,
  isQuickBack,
  isRageClick,
  routeTemplate,
  type PageSample,
  type PointerSample,
  type ReplayMark,
  type ScrollSample,
} from '@builderforce/interaction-contract';

/** Calls `done(quiet)` after `ms`: quiet = no navigation and no DOM mutation meanwhile. */
export type QuietWatcher = (ms: number, done: (quiet: boolean) => void) => void;

/** A short-lived MutationObserver plus a URL check (PRD 33 §8 S2). */
export const watchQuiet: QuietWatcher = (ms, done) => {
  const startHref = location.href;
  let mutated = false;
  let observer: MutationObserver | null = null;
  try {
    observer = new MutationObserver(() => {
      mutated = true;
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch {
    observer = null;
  }
  setTimeout(() => {
    observer?.disconnect();
    done(!mutated && location.href === startHref);
  }, ms);
};

export interface ClickInput {
  /** Viewport coordinates (rage radius). */
  x: number;
  y: number;
  /** Grid cell over the document. */
  gx: number;
  gy: number;
  el: Element;
  selector: string;
  label?: string;
  href?: string;
}

export interface MarkTrackerOptions {
  emit: (mark: ReplayMark) => void;
  /** Visit-relative ms. */
  now: () => number;
  /** Last page entries carried over from earlier page loads of the visit. */
  pages?: PageSample[];
  /** Persist the page history (last three). */
  onPages?: (pages: PageSample[]) => void;
  watchQuiet?: QuietWatcher;
}

const CLICK_KEEP = 10;
const PAGE_KEEP = 3;

export class MarkTracker {
  private clicks: PointerSample[] = [];
  private scrolls: ScrollSample[] = [];
  private pages: PageSample[];
  private lastClickT: number | null = null;
  private route = '/';
  private maxDepth = -1;
  private readonly opts: MarkTrackerOptions;

  constructor(opts: MarkTrackerOptions) {
    this.opts = opts;
    this.pages = (opts.pages ?? []).slice(-PAGE_KEEP);
  }

  get currentRoute(): string {
    return this.route;
  }

  page(path: string): void {
    const t = this.opts.now();
    this.route = routeTemplate(path);
    this.maxDepth = -1;
    this.scrolls = [];
    this.opts.emit({ kind: 'page', key: this.route, atMs: t });
    this.pages = [...this.pages, { path: this.route, t }].slice(-PAGE_KEEP);
    this.opts.onPages?.(this.pages);
    if (isQuickBack(this.pages)) this.opts.emit({ kind: 'quickback', key: this.route, atMs: t });
  }

  click(input: ClickInput): void {
    const t = this.opts.now();
    this.lastClickT = t;
    const shape = {
      key: input.selector,
      atMs: t,
      gx: input.gx,
      gy: input.gy,
      ...(input.label ? { label: input.label } : {}),
    };
    this.opts.emit({ kind: 'click', ...shape, ...(input.href ? { href: input.href } : {}) });

    this.clicks = [...this.clicks, { t, x: input.x, y: input.y }].slice(-CLICK_KEEP);
    if (isRageClick(this.clicks)) {
      this.clicks = [];
      this.opts.emit({ kind: 'rage', ...shape });
      return;
    }
    if (!isDeadClickCandidate(input.el)) return;
    const watch = this.opts.watchQuiet ?? watchQuiet;
    watch(FRUSTRATION_THRESHOLDS.dead.waitMs, (quiet) => {
      if (quiet) this.opts.emit({ kind: 'dead', ...shape });
    });
  }

  /** A scroll sample: `y` = scroll offset, `depth` = (scrollY + viewport) / document height. */
  scroll(y: number, viewportH: number, depth: number): void {
    const t = this.opts.now();
    if (Number.isFinite(depth)) {
      const decile = Math.max(0, Math.min(9, Math.floor(depth * 10)));
      if (decile > this.maxDepth) this.maxDepth = decile;
    }
    const windowMs = FRUSTRATION_THRESHOLDS.excessiveScroll.travelWindowMs;
    this.scrolls = [...this.scrolls.filter((s) => t - s.t <= windowMs), { t, y }];
    if (isExcessiveScroll(this.scrolls, viewportH, this.lastClickT)) {
      this.scrolls = [];
      this.opts.emit({ kind: 'excessive_scroll', key: this.route, atMs: t });
    }
  }

  /** Leaving the page: the max scroll depth decile reached on it, once. */
  leavePage(initialDepth: number): void {
    if (Number.isFinite(initialDepth)) {
      const decile = Math.max(0, Math.min(9, Math.floor(initialDepth * 10)));
      if (decile > this.maxDepth) this.maxDepth = decile;
    }
    if (this.maxDepth < 0) return;
    this.opts.emit({ kind: 'scroll', key: this.route, atMs: this.opts.now(), value: this.maxDepth });
    this.maxDepth = -1;
  }
}
