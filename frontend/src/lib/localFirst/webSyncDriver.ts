/**
 * THE web sync driver — the ONE thing in the web app that pushes the local-first journal.
 *
 * Until this module nothing in `frontend/src` drove `createSyncCoordinator`: work management
 * journalled events and never sent them. The driver is generic (it knows a store, a bound
 * destination and the sync route — nothing about boards or tickets), so work management and the
 * Studio board library share it; a second, canvas-only driver is the thing this exists to prevent.
 *
 * WHEN IT PUSHES: after a commit (debounced), when the browser comes back `online`, when the tab
 * regains focus, and on a timer — with exponential backoff after a failure, and the server's
 * `Retry-After` honoured over it. A 503 / 429 / unreachable network is NOT an error to show: the
 * events stay pending (the coordinator only acknowledges what a receipt settled) and the status
 * carries the held count.
 *
 * WHO PUSHES: `createWebSyncLease` — one tab at a time (Web Locks), fenced within the tab.
 *
 * WHAT IT SENDS WITH: the same bearer + locale headers every API call carries (`getAuthHeaders`),
 * through the guarded platform fetch, so a denied `synchronize` capability stops the request
 * before it exists. Pull is OFF unless asked for: the server projection holds only what push wrote.
 */

import {
  HttpSyncTransportError,
  PlatformAccessDenied,
  SYNC_LEASE_LOST,
  countPending,
  createHttpSyncTransport,
  createSyncCoordinator,
  parseRetryAfter,
  type EntityDestination,
  type HttpSyncFetch,
  type HttpSyncHeaders,
  type LocalFirstStore,
  type PlatformPolicy,
  type SyncLease,
} from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import { getAuthHeaders } from '../apiClient';
import { webPlatformFetch, webPlatformPolicy } from './platformPolicy';
import { reportLocalFirstFailure, type LocalFirstFailureSink } from './reportLocalFirstFailure';
import { createWebSyncLease } from './webSyncLease';

export type WebSyncState = 'idle' | 'syncing' | 'held' | 'offline' | 'denied' | 'unbound' | 'busy';

type SyncCoordinator = ReturnType<typeof createSyncCoordinator>;
export type WebSyncSummary = NonNullable<Awaited<ReturnType<SyncCoordinator['synchronize']>>>;

export interface WebSyncStatus {
  state: WebSyncState;
  /** Events still owed to the server (held ones included): what the sync indicator shows. */
  pending: number;
  lastSummary?: WebSyncSummary;
  /** ISO instant of the last round the server answered. */
  lastSyncedAt?: string;
  /** Why the last round did not complete (a code or message, never a stack). */
  lastError?: string;
  /** ISO instant before which the driver will not try again. */
  nextAttemptAt?: string;
}

export interface WebSyncEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface WebSyncDriverOptions {
  store: LocalFirstStore;
  deviceId: string;
  /** The destination to push, read each round (the signed-in account can change). Unbound sends nothing. */
  destination: () => EntityDestination;
  /** The page's platform policy by default. */
  policy?: PlatformPolicy;
  /** The guarded platform fetch by default; tests inject one. */
  fetch?: HttpSyncFetch;
  baseUrl?: string;
  /** `getAuthHeaders` by default. */
  headers?: HttpSyncHeaders;
  lease?: SyncLease;
  /** Also pull each round. Off by default: pull serves the push projection only. */
  pull?: boolean;
  debounceMs?: number;
  timerMs?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  now?: () => number;
  /** `window` by default (`online`, `offline`, `focus`). */
  events?: WebSyncEventTarget;
  isOnline?: () => boolean;
  report?: LocalFirstFailureSink;
}

export interface WebSyncDriver {
  /** Ask for a round after the debounce (a commit happened). */
  trigger(): void;
  /** Run a round now (single-flight); resolves to the status it ended in. */
  syncNow(): Promise<WebSyncStatus>;
  start(): void;
  stop(): void;
  status(): WebSyncStatus;
  subscribe(listener: (status: WebSyncStatus) => void): () => void;
}

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_TIMER_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 2_000;
const DEFAULT_BACKOFF_CAP_MS = 5 * 60_000;

type FailureKind = 'denied' | 'lease-lost' | 'transient' | 'network' | 'refused' | 'unexpected';

function classify(error: unknown): FailureKind {
  if (error instanceof PlatformAccessDenied) return 'denied';
  if (error instanceof HttpSyncTransportError) {
    return error.status >= 500 || error.status === 429 || error.status === 408 ? 'transient' : 'refused';
  }
  if (error instanceof Error && error.message === SYNC_LEASE_LOST) return 'lease-lost';
  if (error instanceof Error && error.message === 'sync_lease_work_timeout') return 'transient';
  // `fetch` rejects with a TypeError when the network is unreachable, and an aborted request (lease lost) is an AbortError.
  if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) return 'network';
  return 'unexpected';
}

function guardedFetch(): HttpSyncFetch {
  return (url, init) =>
    webPlatformFetch(
      url,
      { method: init.method, headers: init.headers as Record<string, string>, body: init.body, ...(init.signal ? { signal: init.signal } : {}) },
      'synchronize',
    );
}

export function createWebSyncDriver(options: WebSyncDriverOptions): WebSyncDriver {
  const now = options.now ?? Date.now;
  const report = options.report ?? reportLocalFirstFailure;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timerMs = options.timerMs ?? DEFAULT_TIMER_MS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffCapMs = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;
  const events = options.events ?? (typeof window !== 'undefined' ? window : undefined);
  const isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);

  // The server's Retry-After on the last refused response: the package parses it on a 429 only,
  // a 503 carries it too, so the header is read here with the package's own parser.
  let refusedRetryAfterMs: number | undefined;
  const baseFetch = options.fetch ?? guardedFetch();
  const transportFetch: HttpSyncFetch = async (url, init) => {
    const response = await baseFetch(url, init);
    refusedRetryAfterMs = response.ok ? undefined : parseRetryAfter(response.headers?.get('retry-after'), now());
    return response;
  };

  const coordinator = createSyncCoordinator({
    store: options.store,
    transport: createHttpSyncTransport({
      fetch: transportFetch,
      baseUrl: options.baseUrl ?? API_ORIGIN,
      headers: options.headers ?? (() => getAuthHeaders()),
    }),
    policy: options.policy ?? webPlatformPolicy(),
    deviceId: options.deviceId,
    lease: options.lease ?? createWebSyncLease({ deviceId: options.deviceId }),
  });

  let current: WebSyncStatus = { state: 'idle', pending: 0 };
  const listeners = new Set<(status: WebSyncStatus) => void>();
  const publish = (next: Partial<WebSyncStatus> & { state: WebSyncState }): WebSyncStatus => {
    current = { ...current, ...next };
    for (const listener of [...listeners]) listener(current);
    return current;
  };

  let failures = 0;
  let notBefore = 0;
  let running: Promise<WebSyncStatus> | undefined;
  let rerun = false;
  let started = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeStore: (() => void) | undefined;

  const countOwed = async (destination: EntityDestination): Promise<number> => {
    try {
      return await options.store.read((tx) => countPending(tx, destination));
    } catch (error) {
      report('webSyncDriver.countPending', error);
      return current.pending;
    }
  };

  /** A round that did not complete: pace the next one and say why. */
  const failed = (error: unknown): Partial<WebSyncStatus> & { state: WebSyncState } => {
    const kind = classify(error);
    const message = error instanceof Error ? error.message : String(error);
    if (kind === 'denied') return { state: 'denied', lastError: message };
    if (kind === 'lease-lost') return { state: 'busy', lastError: message };
    // A refused request or an unknown failure is a defect to look at; an unreachable network or a
    // 503 is the expected shape of an outage and is carried in the status instead of reported.
    if (kind === 'refused' || kind === 'unexpected') report('webSyncDriver.round', error);
    failures += 1;
    const retryAfterMs = error instanceof HttpSyncTransportError ? error.retryAfterMs ?? refusedRetryAfterMs : undefined;
    const wait = retryAfterMs ?? Math.min(backoffCapMs, backoffBaseMs * 2 ** (failures - 1));
    notBefore = now() + wait;
    return { state: 'held', lastError: message, nextAttemptAt: new Date(notBefore).toISOString() };
  };

  const round = async (): Promise<WebSyncStatus> => {
    const destination = options.destination();
    if (destination.kind !== 'bound') return publish({ state: 'unbound' });
    if (!isOnline()) return publish({ state: 'offline', pending: await countOwed(destination) });
    if (now() < notBefore) return current;
    publish({ state: 'syncing' });
    let outcome: Partial<WebSyncStatus> & { state: WebSyncState };
    let again = false;
    try {
      const summary = await coordinator.synchronize(destination, { pull: options.pull ?? false });
      if (summary === undefined) {
        outcome = { state: 'busy' };
      } else {
        failures = 0;
        notBefore = 0;
        outcome = { state: 'idle', lastSummary: summary, lastSyncedAt: new Date(now()).toISOString(), lastError: undefined, nextAttemptAt: undefined };
        // A full batch leaves more behind: go again at once rather than wait for the timer.
        again = summary.pushed + summary.duplicates > 0;
      }
    } catch (error) {
      outcome = failed(error);
    }
    const pending = await countOwed(destination);
    const status = publish({ ...outcome, pending });
    if (again && pending > 0) rerun = true;
    return status;
  };

  const syncNow = (): Promise<WebSyncStatus> => {
    if (running) {
      rerun = true;
      return running;
    }
    running = round().finally(() => {
      running = undefined;
      if (rerun && started) {
        rerun = false;
        trigger();
      }
    });
    return running;
  };

  const wait = (): number => Math.max(debounceMs, notBefore - now());

  function trigger(): void {
    if (!started) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void syncNow();
    }, wait());
  }

  const armTimer = (): void => {
    if (!started) return;
    intervalTimer = setTimeout(() => {
      void syncNow().finally(armTimer);
    }, Math.max(timerMs, notBefore - now()));
  };

  const onOnline = (): void => {
    // Coming back online is the moment the backoff was waiting for.
    failures = 0;
    notBefore = 0;
    void syncNow();
  };
  const onOffline = (): void => { publish({ state: 'offline' }); };
  const onFocus = (): void => { trigger(); };

  return {
    trigger,
    syncNow,
    status: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      unsubscribeStore = options.store.subscribe((change) => {
        if (!change || change.events) trigger();
      });
      events?.addEventListener('online', onOnline);
      events?.addEventListener('offline', onOffline);
      events?.addEventListener('focus', onFocus);
      armTimer();
      // Whatever a previous session left pending goes up now, not on the first edit.
      trigger();
    },
    stop() {
      started = false;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      if (intervalTimer !== undefined) clearTimeout(intervalTimer);
      debounceTimer = undefined;
      intervalTimer = undefined;
      unsubscribeStore?.();
      unsubscribeStore = undefined;
      events?.removeEventListener('online', onOnline);
      events?.removeEventListener('offline', onOffline);
      events?.removeEventListener('focus', onFocus);
    },
  };
}
