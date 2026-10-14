/**
 * The loader's work, side-effect free so the loader entry, the embed rail and
 * the tests share it (PRD 33 §3, D5, D7).
 *
 * 1. Read `data-site`, `data-release`, `data-variant`, `data-api` off the tag.
 * 2. Install a queued `window.BFReplay` stub (so page code never breaks).
 * 3. Do Not Track / Global Privacy Control → stop, before any network call.
 * 4. `GET /api/replay-ingest/v1/config?site=…` without credentials.
 * 5. `enabled: false` → stop. `consentRequired` → wait for `BFReplay.consent(true)`.
 * 6. Hand `{ config, site, release, variant, api, queue }` over on
 *    `window.__bfReplay` and inject the recorder the config names.
 *
 * Kept tiny on purpose (≤ 2 KB gzip): no recorder code, no contract code
 * beyond the path table.
 */

import { REPLAY_API_ORIGIN, REPLAY_PATHS, type ReplayClientConfig } from '@builderforce/interaction-contract';
import { QUEUED_METHODS, type BFReplayApi, type QueuedCall } from './handoff';

export interface LoaderOptions {
  /** The loader's own `<script>`; defaults to `document.currentScript`. */
  script?: HTMLScriptElement | null;
  fetchFn?: typeof fetch;
}

function privacySignal(): boolean {
  const nav = navigator as unknown as { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function inject(src: string): void {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  s.crossOrigin = 'anonymous';
  (document.head || document.documentElement).appendChild(s);
}

/** Resolves once the loader has done everything it will do for this page. */
export function boot(opts: LoaderOptions = {}): Promise<void> {
  const script = opts.script !== undefined ? opts.script : (document.currentScript as HTMLScriptElement | null);
  const data: DOMStringMap = script ? script.dataset : {};
  const site = data.site;
  // No key, or a recorder (or stub) already installed by another tag.
  if (!site || window.BFReplay) return Promise.resolve();

  const queue: QueuedCall[] = [];
  let consented = false;
  let onConsent: (() => void) | null = null;
  const stub: Record<string, unknown> = { version: 'loader' };
  for (const method of QUEUED_METHODS) {
    stub[method] = (...args: unknown[]) => {
      queue.push([method, args]);
      if (method === 'consent') {
        consented = args[0] === true;
        if (consented && onConsent) onConsent();
      }
    };
  }
  window.BFReplay = stub as unknown as BFReplayApi;

  if (privacySignal()) return Promise.resolve();

  const api = (data.api || REPLAY_API_ORIGIN).replace(/\/+$/, '');
  const fetchFn = opts.fetchFn ?? fetch;
  return fetchFn(`${api}${REPLAY_PATHS.ingestConfig}?site=${encodeURIComponent(site)}`, { credentials: 'omit' })
    .then((res) => (res.ok ? (res.json() as Promise<ReplayClientConfig>) : null))
    .then((config) => {
      const recorderUrl = config && config.enabled ? config.recorderUrl : undefined;
      if (!config || !recorderUrl) return;
      const cfg: ReplayClientConfig = config;
      const start = () => {
        onConsent = null;
        window.__bfReplay = { config: cfg, site, release: data.release, variant: data.variant, api, queue };
        inject(recorderUrl);
      };
      if (cfg.consentRequired && !consented) onConsent = start;
      else start();
    })
    .catch(() => {
      /* fail closed: no recording, the stub keeps the page safe */
    });
}
