/**
 * Hashed recorder IIFE — rrweb + interaction events + frustration marks + vitals.
 *
 * Loaded by `loader.js` after it reads `/replay/manifest.json`. The global name
 * is `BuilderForceReplayRecorder`.
 */

import { deriveSelector, type ReplayChunkEvent } from '@builderforce/interaction-contract';
import { ChunkBatch } from './batch';
import { getVisitId, getVisitorId } from './ids';
import { maskInputFn, unmask as registerUnmask, shouldMask } from './masking';
import { MarkTracker } from './marks';
import { attach, installGlobal, session, type ReplayInit } from './publicApi';
import { record as rrwebRecord } from 'rrweb';
import { observeVitals } from './vitals';

const DEFAULT_ENDPOINT = 'https://api.builderforce.ai';

export interface RecorderHandle {
  stop(): void;
}

function ingestUrl(endpoint: string, key: string): string {
  const base = endpoint.replace(/\/$/, '');
  return `${base}/v1/replay/ingest?key=${encodeURIComponent(key)}`;
}

export function startRecorder(opts: ReplayInit): RecorderHandle | null {
  const visitorId = getVisitorId();
  const visitId = getVisitId();
  if (!visitorId || !visitId || !opts.key) return null;

  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const batch = new ChunkBatch({ url: ingestUrl(endpoint, opts.key), visitId });

  const origin = typeof performance !== 'undefined' ? performance.now() : 0;
  const at = () => Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - origin));

  const push = (event: ReplayChunkEvent) => batch.push(event);
  const marks = new MarkTracker({ emit: (mark) => batch.addMark(mark) });

  push({
    t: 0,
    kind: 'pageview',
    path: typeof location !== 'undefined' ? location.pathname : '/',
    visitorId,
  });

  const onClick = (ev: MouseEvent) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const { selector } = deriveSelector(target);
    const t = at();
    push({ t, kind: 'click', x: ev.clientX, y: ev.clientY, selector });
    marks.click({ t, x: ev.clientX, y: ev.clientY }, selector, target);
  };

  const onScroll = () => {
    const t = at();
    const y = typeof window !== 'undefined' ? window.scrollY : 0;
    push({ t, kind: 'scroll', y });
    marks.scroll({ t, y }, typeof window !== 'undefined' ? window.innerHeight : 800);
  };

  const onError = (ev: ErrorEvent) => {
    const t = at();
    const key = ev.message || 'error';
    push({ t, kind: 'error', key });
    marks.error(key, t);
  };

  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('error', onError);
  const stopVitals = observeVitals(push);

  let stopRrweb: (() => void) | undefined;
  try {
    stopRrweb = rrwebRecord({
      emit(event: unknown) {
        const rec = event as { timestamp?: number; type?: number; data?: unknown };
        push({
          t: at(),
          kind: 'snapshot',
          type: rec.type,
          data: rec.data,
        });
      },
      maskAllInputs: true,
      maskInputFn: (text: string, el: HTMLElement) => {
        if (el && typeof el.matches === 'function' && !shouldMask(el)) return text;
        return maskInputFn(text, el);
      },
    }) ?? undefined;
  } catch {
    stopRrweb = undefined;
  }

  const onHide = () => {
    void batch.flush(true);
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });

  const api = {
    init(_opts: ReplayInit) {
      /* already started */
    },
    identify(userId: string, traits?: Record<string, unknown>) {
      batch.setTag('userId', userId);
      if (traits) {
        for (const [k, v] of Object.entries(traits)) {
          if (typeof v === 'string') batch.setTag(k, v);
        }
      }
      push({ t: at(), kind: 'identify', userId });
    },
    setTag(key: string, value: string) {
      batch.setTag(key, value);
    },
    track(name: string, props?: Record<string, unknown>) {
      push({ t: at(), kind: 'event', name, ...(props ?? {}) });
    },
    stop() {
      handle.stop();
    },
    unmask(selector: string) {
      registerUnmask(selector);
    },
  };

  const handle: RecorderHandle = {
    stop() {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('error', onError);
      window.removeEventListener('pagehide', onHide);
      stopVitals();
      stopRrweb?.();
      void batch.flush(true);
    },
  };

  attach(api);
  return handle;
}

installGlobal();

const exported = {
  ...session,
  // After the spread: the recorder's `init` must win over the bare session one.
  init(opts: ReplayInit) {
    session.init(opts);
    return startRecorder(opts);
  },
};

export default exported;

if (typeof window !== 'undefined') {
  (window as unknown as { BuilderForceReplayRecorder?: typeof exported }).BuilderForceReplayRecorder = exported;
}
