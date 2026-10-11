/**
 * Frustration marks — rage, dead click, quick-back, excessive scroll.
 * Detectors live on the interaction contract; this file only buffers samples.
 */

import {
  FRUSTRATION_THRESHOLDS,
  isDeadClickCandidate,
  isExcessiveScroll,
  isQuickBack,
  isRageClick,
  type PageSample,
  type PointerSample,
  type ReplayMark,
  type ScrollSample,
  type SelectorElement,
} from '@builderforce/interaction-contract';

const RAGE_KEEP = 12;
const PAGE_KEEP = 8;
const SCROLL_KEEP = 40;

export class MarkTracker {
  private clicks: PointerSample[] = [];
  private pages: PageSample[] = [];
  private scrolls: ScrollSample[] = [];
  private readonly emit: (mark: ReplayMark) => void;
  private readonly now: () => number;

  constructor(opts: { emit: (mark: ReplayMark) => void; now?: () => number }) {
    this.emit = opts.emit;
    this.now = opts.now ?? (() => Date.now());
  }

  click(sample: PointerSample, selector: string, el: SelectorElement | null): ReplayMark | null {
    this.clicks.push(sample);
    if (this.clicks.length > RAGE_KEEP) this.clicks.shift();
    if (isRageClick(this.clicks)) {
      const mark: ReplayMark = { kind: 'rage', key: selector, atMs: sample.t };
      this.emit(mark);
      this.clicks = [];
      return mark;
    }
    if (el && isDeadClickCandidate(el)) {
      const wait = FRUSTRATION_THRESHOLDS.deadClick.waitMs;
      const started = sample.t;
      const timer = setTimeout(() => {
        if (this.now() - started >= wait) {
          this.emit({ kind: 'dead', key: selector, atMs: sample.t });
        }
      }, wait);
      if (typeof timer === 'object' && 'unref' in timer) (timer as { unref: () => void }).unref();
    }
    return null;
  }

  page(sample: PageSample): ReplayMark | null {
    this.pages.push(sample);
    if (this.pages.length > PAGE_KEEP) this.pages.shift();
    if (isQuickBack(this.pages)) {
      const mark: ReplayMark = { kind: 'quickback', key: sample.path, atMs: sample.t };
      this.emit(mark);
      return mark;
    }
    return null;
  }

  scroll(sample: ScrollSample, viewportHeight: number): ReplayMark | null {
    this.scrolls.push(sample);
    if (this.scrolls.length > SCROLL_KEEP) this.scrolls.shift();
    if (isExcessiveScroll(this.scrolls, { viewportHeight })) {
      const mark: ReplayMark = { kind: 'excessive_scroll', key: 'scroll', atMs: sample.t };
      this.emit(mark);
      this.scrolls = [];
      return mark;
    }
    return null;
  }

  error(key: string, atMs: number): ReplayMark {
    const mark: ReplayMark = { kind: 'error', key, atMs };
    this.emit(mark);
    return mark;
  }
}
