/**
 * The hashed recorder — `https://cdn.builderforce.ai/replay/r/recorder.<hash>.js`
 * (PRD 33 §3, §8 S2). Injected by the loader, which leaves the site config
 * and the stub's call queue on `window.__bfReplay`.
 *
 * Every session sends chunks with marks (route counts, frustration, heat,
 * vitals and issues are exact over every session). Only KEPT sessions send
 * rrweb events: a session is kept by the head sample (`keepRate`) or, while
 * buffering the last 60 s, by a trigger — rage / dead / quick back
 * ('frustration'), an error ('error'), a sign-up / purchase / checkout smart
 * event ('goal'), `BFReplay.tag()` ('tag') or `BFReplay.keep()` ('manual').
 *
 * Never breaks the host page: every handler is guarded, and any thrown error
 * disables the recorder with one console warning.
 */

import { record as rrwebRecord } from 'rrweb';
import {
  GOAL_SMART_EVENTS,
  REPLAY_LIMITS,
  REPLAY_PATHS,
  REPLAY_STRING_LIMITS,
  deriveSelector,
  smartEventsForMark,
  toGridCell,
  type KeepReason,
  type ReplayIdentify,
  type ReplayMark,
} from '@builderforce/interaction-contract';
import { touchActivity } from './activity';
import { ChunkBatch, type BatchSink, type ChunkHeader, type Compressor } from './batch';
import { EventRing } from './buffer';
import { browserOf, deviceInfo, docSize, osOf, referrerHost } from './env';
import { errorMark, watchErrors } from './errors';
import type { ReplayHandoff } from './handoff';
import { idNamespace, resolveIdentity, storageKeys, touchVisit } from './ids';
import { MarkTracker, type QuietWatcher } from './marks';
import { isMaskedText, rrwebPrivacyOptions, sanitizeHref } from './masking';
import { watchNavigation } from './navigation';
import { createPublicApi, replayQueue } from './publicApi';
import { explicitRelease, resolveRelease } from './releaseKey';
import { observeVitals } from './vitals';
import { VisitStore } from './visitState';

declare const __BF_RECORDER_VERSION__: string | undefined;

/** Package version stamped at build time; 'dev' in tests. */
export const RECORDER_BUILD_VERSION: string =
  typeof __BF_RECORDER_VERSION__ === 'string' ? __BF_RECORDER_VERSION__ : 'dev';

const FRUSTRATION_TRIGGERS = new Set<ReplayMark['kind']>(['rage', 'dead', 'quickback']);
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel'] as const;
const SCROLL_SAMPLE_MS = 150;
const MOVE_SAMPLE_MS = 1_000;

export interface RecorderDeps {
  random?: () => number;
  sink?: BatchSink;
  compress?: Compressor;
  record?: typeof rrwebRecord;
  watchQuiet?: QuietWatcher;
}

export interface RecorderHandle {
  stop(): void;
  /** Flush now (tests, pagehide). */
  flush(final: boolean): Promise<void>;
}

function maskedSelector(el: Element): { selector: string; label?: string } {
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
  if (testId) return { selector: `getByTestId(${JSON.stringify(testId)})`, label: testId };
  return { selector: el.tagName.toLowerCase() };
}

function scrollDepth(): number {
  const { docH } = docSize();
  return docH > 0 ? (window.scrollY + window.innerHeight) / docH : 1;
}

export function startRecorder(handoff: ReplayHandoff, deps: RecorderDeps = {}): RecorderHandle | null {
  const config = handoff.config;
  if (!config.enabled) return null;
  const record = deps.record ?? rrwebRecord;
  const random = deps.random ?? Math.random;
  const cleanups: Array<() => void> = [];
  let stopped = false;
  let stopRrweb: (() => void) | undefined;

  const ns = idNamespace(location.hostname);
  const identity = resolveIdentity(ns);
  const store = new VisitStore(storageKeys(ns).state, identity.visitId, Date.now());
  const state = store.state;
  const atMs = () => Math.max(0, Date.now() - state.startedAt);

  // Head sample, once per visit.
  if (state.sampled === null) {
    const rate = Math.min(1, Math.max(0, config.keepRate ?? 1));
    state.sampled = rate > 0 && random() < rate;
    if (state.sampled && state.keep === null) {
      state.keep = 'sample';
      state.sampleWeight = 1 / rate;
    }
    store.save();
  }

  let release = explicitRelease(handoff.release);
  if (!release) void resolveRelease().then((key) => (release = key));
  const tags: Record<string, string> = {};
  let identify: ReplayIdentify | undefined;
  let ended = false;
  const ua = navigator.userAgent || '';
  const recorderVersion = (config.recorderVersion || RECORDER_BUILD_VERSION).slice(0, REPLAY_STRING_LIMITS.recorderVersion);

  const header = (): ChunkHeader => {
    touchVisit(ns);
    const h: ChunkHeader = {
      v: 1,
      visitorId: identity.visitorId,
      visitId: identity.visitId,
      startedAt: state.startedAt,
      release,
      recorderVersion,
      device: deviceInfo(),
      newVisitor: identity.newVisitor,
      keep: state.keep,
      sampleWeight: state.keep ? state.sampleWeight : 1,
      activeMs: Math.round(state.activeMs),
    };
    const browser = browserOf(ua);
    const os = osOf(ua);
    const referrer = referrerHost(document.referrer, location.hostname);
    if (browser) h.browser = browser;
    if (os) h.os = os;
    if (referrer) h.referrer = referrer;
    if (handoff.variant) h.variant = handoff.variant.slice(0, REPLAY_STRING_LIMITS.variant);
    if (Object.keys(tags).length > 0) h.tags = { ...tags };
    if (identify) h.identify = identify;
    if (ended) h.end = true;
    return h;
  };

  const batch = new ChunkBatch({
    url: `${handoff.api}${REPLAY_PATHS.ingestChunks}?site=${encodeURIComponent(handoff.site)}`,
    header,
    nextSeq: () => store.nextSeq(),
    sink: deps.sink,
    compress: deps.compress,
  });
  const ring = new EventRing();

  const disable = (error: unknown) => {
    if (stopped) return;
    try {
      console.warn('[BFReplay] recorder disabled after an error', error);
    } catch {
      /* no console */
    }
    shutdown(false);
  };

  /** Run page-facing work so a failure can never reach the host page. */
  function guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      if (stopped) return;
      try {
        fn(...args);
      } catch (error) {
        disable(error);
      }
    };
  }

  const startRrweb = (kept: boolean) => {
    const stop = record({
      emit: guard((event: unknown, isCheckout?: boolean) => {
        if (state.keep) batch.pushEvent(event);
        else ring.push(event, isCheckout === true);
      }),
      ...rrwebPrivacyOptions(config),
      ...(kept ? {} : { checkoutEveryNms: REPLAY_LIMITS.bufferMs }),
      // Repeated after every spread: no config can turn input masking off.
      maskAllInputs: true,
    });
    return stop ?? undefined;
  };

  const setKeep = (reason: KeepReason) => {
    if (state.keep) return;
    state.keep = reason;
    state.sampleWeight = 1;
    store.save();
    for (const event of ring.drain()) batch.pushEvent(event);
    // Restart without periodic checkouts: a kept recording streams from here.
    stopRrweb?.();
    stopRrweb = startRrweb(true);
  };

  const addMark = (mark: ReplayMark) => {
    if (state.marks >= REPLAY_LIMITS.maxMarksPerVisit) return;
    state.marks += 1;
    store.save();
    batch.addMark(mark);
    if (FRUSTRATION_TRIGGERS.has(mark.kind)) setKeep('frustration');
    else if (mark.kind === 'error') setKeep('error');
    else if ((mark.kind === 'click' || mark.kind === 'page') && smartEventsForMark(mark).some((name) => (GOAL_SMART_EVENTS as readonly string[]).includes(name))) {
      setKeep('goal');
    }
  };

  const tracker = new MarkTracker({
    emit: addMark,
    now: atMs,
    pages: state.pages,
    onPages: (pages) => {
      state.pages = pages;
      store.save();
    },
    watchQuiet: deps.watchQuiet,
  });

  const activity = guard(() => touchActivity(state, Date.now()));
  let lastMove = 0;
  const onMove = guard(() => {
    const now = Date.now();
    if (now - lastMove < MOVE_SAMPLE_MS) return;
    lastMove = now;
    touchActivity(state, now);
  });

  const onClick = guard((ev: MouseEvent) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    touchActivity(state, Date.now());
    const masked = isMaskedText(target, config.maskAllText === true);
    const { selector, label } = masked ? maskedSelector(target) : deriveSelector(target);
    const { docW, docH } = docSize();
    const pageX = typeof ev.pageX === 'number' ? ev.pageX : ev.clientX + window.scrollX;
    const pageY = typeof ev.pageY === 'number' ? ev.pageY : ev.clientY + window.scrollY;
    const { gx, gy } = toGridCell(pageX, pageY, docW, docH);
    const anchor = target.closest('a[href]');
    tracker.click({
      x: ev.clientX,
      y: ev.clientY,
      gx,
      gy,
      el: target,
      selector: selector.slice(0, REPLAY_STRING_LIMITS.markKey),
      label: label ? label.slice(0, REPLAY_STRING_LIMITS.markLabel) : undefined,
      href: anchor ? sanitizeHref(anchor.getAttribute('href'), location.href) : undefined,
    });
  });

  let lastScroll = 0;
  const onScroll = guard(() => {
    const now = Date.now();
    touchActivity(state, now);
    if (now - lastScroll < SCROLL_SAMPLE_MS) return;
    lastScroll = now;
    tracker.scroll(window.scrollY, window.innerHeight, scrollDepth());
  });

  const vitals = observeVitals();
  const onPageHide = guard(() => {
    tracker.leavePage(scrollDepth());
    for (const mark of vitals.take(atMs())) addMark(mark);
    store.save();
    void batch.flush(true);
  });
  const onVisibility = guard(() => {
    if (document.visibilityState === 'hidden') {
      store.save();
      void batch.flush(true);
    }
  });

  const listen = <K extends keyof WindowEventMap>(type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    window.addEventListener(type, fn, opts);
    cleanups.push(() => window.removeEventListener(type, fn, opts));
  };

  function shutdown(final: boolean): void {
    if (stopped) return;
    stopped = true;
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        /* keep going */
      }
    }
    try {
      stopRrweb?.();
    } catch {
      /* ignore */
    }
    stopRrweb = undefined;
    vitals.stop();
    ring.drain();
    if (window.BFReplay === api) window.BFReplay = inert;
    if (final) {
      ended = true;
      void batch.flush(true);
    }
  }

  const api = createPublicApi(
    {
      consent: (granted) => {
        if (!granted) shutdown(true);
      },
      event: guard((name: string) => addMark({ kind: 'event', key: name, atMs: atMs() })),
      tag: guard((key: string, value: string) => {
        tags[key] = value;
        setKeep('tag');
      }),
      identify: guard((id: string, traits?: Record<string, string>) => {
        identify = traits ? { id, traits } : { id };
      }),
      keep: guard(() => setKeep('manual')),
      stop: () => shutdown(true),
    },
    { version: recorderVersion, identify: config.identify === true, tagKeys: () => Object.keys(tags) },
  );
  const inert = createPublicApi(
    { consent() {}, event() {}, tag() {}, identify() {}, keep() {}, stop() {} },
    { version: recorderVersion, identify: false },
  );

  try {
    window.BFReplay = api;
    stopRrweb = startRrweb(state.keep !== null);
    tracker.page(location.pathname);
    listen('click', onClick, { capture: true, passive: true });
    listen('scroll', onScroll, { passive: true });
    listen('pagehide', onPageHide);
    for (const type of ACTIVITY_EVENTS) {
      listen(type, type === 'mousemove' ? onMove : activity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    cleanups.push(watchErrors(guard((message: string, stack?: string) => addMark(errorMark(message, stack, atMs())))));
    cleanups.push(
      watchNavigation(
        guard((path: string) => {
          tracker.leavePage(scrollDepth());
          tracker.page(path);
        }),
      ),
    );
    replayQueue(api, handoff.queue);
  } catch (error) {
    disable(error);
    return null;
  }

  return {
    stop: () => shutdown(true),
    flush: (final) => batch.flush(final),
  };
}

if (typeof window !== 'undefined' && window.__bfReplay) {
  try {
    startRecorder(window.__bfReplay);
  } catch {
    /* never break the host page */
  }
}
