/**
 * npm entry — `startReplay({ site })` adds the same loader tag the snippet
 * does, so an npm install self-updates: the loader URL never changes and the
 * config answer names the current recorder (PRD 33 §3.5).
 */

import { replayLoaderUrl } from '@builderforce/interaction-contract';

export interface StartReplayOptions {
  /** `bfr_…` site key (or `hosted:<siteId>`). */
  site: string;
  /** Release name; otherwise the recorder fingerprints the page's assets. */
  release?: string;
  /** API origin override (`data-api`). */
  api?: string;
  /** A/B variant label (`data-variant`). */
  variant?: string;
  /** CDN origin override (tests, staging). */
  cdn?: string;
}

const LOADER_MARKER = 'data-bf-replay-loader';

/** Inject the loader once. Safe during SSR and when called twice. */
export function startReplay(opts: StartReplayOptions): void {
  if (typeof document === 'undefined' || !opts || !opts.site) return;
  if (document.querySelector(`script[${LOADER_MARKER}]`)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = replayLoaderUrl(opts.cdn);
  s.setAttribute(LOADER_MARKER, '');
  s.dataset.site = opts.site;
  if (opts.release) s.dataset.release = opts.release;
  if (opts.api) s.dataset.api = opts.api;
  if (opts.variant) s.dataset.variant = opts.variant;
  (document.head || document.documentElement).appendChild(s);
}
