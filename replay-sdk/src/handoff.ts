/**
 * The loader → recorder hand-off and the public `window.BFReplay` surface.
 *
 * Types only (plus the method list), so the ≤2 KB loader and the recorder
 * agree on one shape without the loader pulling recorder code.
 */

import type { ReplayClientConfig } from '@builderforce/interaction-contract';

/** Methods a page may call before the recorder is up; the loader stub queues them in order. */
export const QUEUED_METHODS = ['consent', 'event', 'tag', 'identify', 'keep', 'stop'] as const;

export type ReplayMethod = (typeof QUEUED_METHODS)[number];

export type QueuedCall = [method: ReplayMethod, args: unknown[]];

/** `window.BFReplay` — the one public API, stub or live. */
export interface BFReplayApi {
  consent(granted: boolean): void;
  event(name: string): void;
  tag(key: string, value: string): void;
  identify(id: string, traits?: Record<string, string>): void;
  keep(): void;
  stop(): void;
  readonly version: string;
}

/** What the loader leaves on `window.__bfReplay` for the recorder it injects. */
export interface ReplayHandoff {
  config: ReplayClientConfig;
  /** `bfr_…` site key or `hosted:<siteId>`. */
  site: string;
  /** `data-release`. */
  release?: string;
  /** `data-variant`. */
  variant?: string;
  /** API origin, no trailing slash. */
  api: string;
  /** Calls made on the stub, oldest first; the recorder replays them on start. */
  queue: QueuedCall[];
}

declare global {
  interface Window {
    BFReplay?: BFReplayApi;
    __bfReplay?: ReplayHandoff;
    /** A page's own release name (PRD 33 §3.1, step 1). */
    BF_RELEASE?: string;
  }
}
