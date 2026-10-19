/**
 * Rovr's SERVICE WORKER — the owner of everything that has to happen with the side panel
 * closed, and of nothing else:
 *
 *   - opens the side panel from the toolbar button (and its keyboard shortcut);
 *   - OWNS the network: the chat sync outbox (messages, step rows, tasks) and the error
 *     report outbox are created here and only here, so two contexts never drain one store;
 *   - replays the backlog: on start, on `online`, on sign-in, and on an alarm that wakes
 *     the worker every minute while anything is queued — an MV3 worker sleeps after ~30 s
 *     idle, and its timers die with it, but the queue is in IndexedDB and the alarm brings
 *     the worker (and the queue) back.
 *
 * The agent loop does NOT run here (see `host/rovrRunHost.ts` for why).
 *
 * `bootRovrServiceWorker` is the only composition root. The extension calls it once, below.
 * A test calls the same function with the network denied. There is no second policy.
 */
import { createIndexedDbOutboxStore, createOnlineSignal } from '@builderforce/write-outbox';
import { createApiClient } from '../api/apiClient';
import { createSession } from '../auth/session';
import { DEFAULT_BASE_URL, ERROR_OUTBOX_DB, LOCAL_DB, SYNC_ALARM, SYNC_ALARM_MINUTES, SYNC_OUTBOX_DB } from '../config';
import { createRovrGuardedFetch } from '../platform/guardedFetch';
import { chromeKeyValue, type KeyValueStore } from '../platform/keyValue';
import { createRovrPlatformPolicy } from '../platform/policy';
import { createSettings } from '../platform/settings';
import { createIdbRecords } from '../store/idbRecords';
import { createChatSync, type SyncItem } from '../sync/chatSync';
import { isRovrRuntimeMessage, type SyncStats, type SyncStatsChanged } from '../sync/runtimeMessages';
import type { ClientErrorEvent } from '../telemetry/errorEvents';
import { createErrorReports, REPORT_LANE } from '../telemetry/errorReports';

/** Partition that holds a local replay receipt. The send queue is a different partition. */
export const ROVR_REPLAY_PARTITION = 'replayed';

/** One batch replayed on this device. Not a platform acknowledgement. */
export interface RovrReplayReceipt {
  idempotencyKey: string;
  count: number;
  ids: string[];
}

export interface BootRovrServiceWorkerOptions {
  /** Durable store. The extension uses the worker's IndexedDB; a test injects one that outlives the boot. */
  indexedDB?: IDBFactory;
  /** Policy and session storage. The extension uses `chrome.storage.local`. */
  storage?: KeyValueStore;
  /** Denied: the backlog is written and replayed locally. No platform fetch is attempted. */
  network?: 'denied';
  /** Install chrome.runtime / alarm listeners. Default: the extension host, not an injected store. */
  listen?: boolean;
}

export interface RovrServiceWorkerBoot {
  /** The policy and the durable queue have been read. */
  ready(): Promise<void>;
  /** Queue one item and resolve only after IndexedDB acknowledges it. Does not fetch. */
  writeDurable(chatId: number, item: SyncItem): Promise<string>;
  /**
   * Replay one queued batch. While the network is denied this writes a local receipt and
   * does not call platform fetch. The send-queue row stays, so a later grant can still flush it.
   */
  replayBatch(): Promise<{ count: number; idempotencyKey: string }>;
  /** Drop timers. IndexedDB rows remain for the next boot. */
  stop(): void;
}

export function bootRovrServiceWorker(options: BootRovrServiceWorkerOptions = {}): RovrServiceWorkerBoot {
  const networkDenied = options.network === 'denied';
  const listen = options.listen ?? options.indexedDB === undefined;
  const indexedDB = options.indexedDB ?? self.indexedDB;
  const local = options.storage ?? chromeKeyValue('local');

  // The PLATFORM POLICY is composed here, before anything can reach the network (G01/G02):
  // the worker reads the persisted `policy.*` capabilities at startup and refuses every
  // platform request and every outbox send while they are denied. On a fresh install there
  // are no keys, so the default is API-denied — connectivity and signing in grant nothing.
  // `ready()` is the FIRST read of storage, awaited below before any fetch or flush runs.
  const platformPolicy = createRovrPlatformPolicy(local);

  // Every platform call the worker makes goes through this: a BuilderForce origin is
  // classified into a capability and refused (before `fetch` is called) unless the policy
  // allows it; any other origin — loopback inference, a provider called directly — passes
  // through untouched.
  const fetchImpl = createRovrGuardedFetch({
    policy: platformPolicy,
    onRequest: (record) => {
      if (record.outcome === 'blocked') console.warn(`Rovr platform: ${record.capability} denied (${record.url})`);
    },
  });

  const session = createSession({ storage: local, baseUrl: DEFAULT_BASE_URL, fetch: fetchImpl, now: Date.now });
  const settings = createSettings(local);
  const api = createApiClient({ session, baseUrl: DEFAULT_BASE_URL, fetch: fetchImpl });
  const records = createIdbRecords(indexedDB, LOCAL_DB);
  const syncStore = createIndexedDbOutboxStore<SyncItem, number>({ indexedDB, dbName: SYNC_OUTBOX_DB, partition: 'chats' });

  // Connectivity, from the worker's own events — the queue waits offline and replays on return.
  // It starts OFFLINE: the outboxes are built at boot and a stored backlog leaves as soon as
  // it loads, so a `true` here would let a denied worker send before the policy has been read.
  // It turns on after `ready()`, and only when `synchronize` is allowed. A denied boot never turns it on.
  const online = createOnlineSignal(false);
  const browserReached = (): boolean => !networkDenied && typeof self !== 'undefined' && self.navigator.onLine;
  const connectivity = (reached: boolean): void => online.set(reached && platformPolicy.allows('synchronize'));

  const chatSync = createChatSync({
    api,
    records,
    store: syncStore,
    online,
    scope: () => session.scope(),
    taskProjectId: () => settings.taskProjectId(),
    onError: (error) => console.warn('Rovr sync: will retry', error),
  });

  const errorReports = createErrorReports({
    api,
    store: createIndexedDbOutboxStore<ClientErrorEvent, string>({ indexedDB, dbName: ERROR_OUTBOX_DB, partition: REPORT_LANE }),
    online,
    scope: () => session.scope(),
  });

  const receiptStore = createIndexedDbOutboxStore<RovrReplayReceipt, string>({
    indexedDB,
    dbName: SYNC_OUTBOX_DB,
    partition: ROVR_REPLAY_PARTITION,
  });

  const flushAll = async (): Promise<void> => {
    await session.ready();
    // The persisted policy is read BEFORE anything leaves — on a fresh install it is still
    // loading here, and the answer (denied) is the one that must win. With `synchronize`
    // denied NOTHING is flushed: every entry stays queued, the alarm stays armed so the
    // backlog is still there when it is granted, and no platform request is attempted.
    await platformPolicy.ready();
    connectivity(browserReached());
    if (!platformPolicy.allows('synchronize')) return;
    await Promise.all([chatSync.flush(), errorReports.flush()]);
  };

  const stats = (): SyncStats => {
    const a = chatSync.stats();
    return { queued: a.queued, inFlight: a.inFlight, dropped: a.dropped };
  };

  /** Keep an alarm while there is a backlog, so the worker wakes to replay it. */
  const keepAlarm = async (): Promise<void> => {
    const pending = chatSync.size() + errorReports.size();
    const existing = await chrome.alarms.get(SYNC_ALARM);
    if (pending > 0 && !existing) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_ALARM_MINUTES });
    if (pending === 0 && existing) await chrome.alarms.clear(SYNC_ALARM);
  };

  if (listen) {
    self.addEventListener('online', () => connectivity(true));
    self.addEventListener('offline', () => connectivity(false));
    // Revoking sync mid-session must also close the door the retry/probe path walks through.
    platformPolicy.subscribe(() => connectivity(self.navigator.onLine));

    // Every change of the queue reaches an open panel's "waiting to sync" — pushed, never polled.
    // With no panel open there is no receiver and the send rejects; that is expected.
    chatSync.subscribe(() => {
      const message: SyncStatsChanged = { type: 'rovr.sync.changed', stats: stats() };
      chrome.runtime.sendMessage(message).catch(() => undefined);
    });

    // A sign-in (in the panel) is a new identity: replay what waited for one.
    session.subscribe(() => {
      if (session.isSignedIn()) void flushAll();
    });

    chrome.runtime.onInstalled.addListener(() => {
      void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    });
    chrome.runtime.onStartup.addListener(() => {
      void flushAll().then(keepAlarm);
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SYNC_ALARM) void flushAll().then(keepAlarm);
    });

    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      // Only the extension's own pages talk to the worker; a content script never does.
      if (sender.id !== chrome.runtime.id || sender.tab || !isRovrRuntimeMessage(message)) return false;
      switch (message.type) {
        case 'rovr.sync.enqueue':
          for (const item of message.items) chatSync.enqueue(message.chatId, item);
          void keepAlarm();
          sendResponse(true);
          return false;
        case 'rovr.sync.flush':
          void flushAll().then(() => sendResponse(stats()));
          return true;
        case 'rovr.sync.stats':
          sendResponse(stats());
          return false;
        case 'rovr.error.report':
          void settings.reportErrors().then((on) => {
            if (on) {
              errorReports.enqueue(REPORT_LANE, message.event);
              void keepAlarm();
            }
            sendResponse(on);
          });
          return true;
      }
    });

    void flushAll().then(keepAlarm);
  }

  const ready = async (): Promise<void> => {
    await session.ready();
    await platformPolicy.ready();
    await chatSync.ready();
  };

  return {
    ready,
    async writeDurable(chatId, item) {
      await ready();
      // Durable user work: resolve only after the store acknowledges the row.
      return chatSync.enqueueDurable(chatId, item);
    },
    async replayBatch() {
      await ready();
      // Denied, or sync not granted: replay on this device. Do not flush — flush is the platform path.
      if (!networkDenied && platformPolicy.allows('synchronize') && online.isOnline()) {
        await chatSync.flush();
        return { count: 0, idempotencyKey: '' };
      }
      const queued = (await syncStore.load()).filter((entry) => !entry.deadLetter);
      const key = queued[0]?.key;
      const batch = queued.filter((entry) => entry.key === key);
      if (batch.length === 0 || key === undefined) return { count: 0, idempotencyKey: '' };
      const idempotencyKey = batch[0]?.batch ?? batch[0]?.id ?? '';
      // Same object store as the send queue (keyPath `id`). A receipt must not reuse an entry id
      // or the put replaces the backlog row.
      const receiptId = `replay:${idempotencyKey}`;
      const already = (await receiptStore.load()).some((entry) => entry.id === receiptId);
      if (already) return { count: 0, idempotencyKey };
      const receipt: RovrReplayReceipt = { idempotencyKey, count: batch.length, ids: batch.map((entry) => entry.id) };
      await receiptStore.put([{ id: receiptId, key: String(key), item: receipt, seq: batch[0]?.seq ?? 0 }]);
      return { count: batch.length, idempotencyKey };
    },
    stop() {
      chatSync.close();
      errorReports.close();
    },
  };
}

// The extension host starts by calling the same boot. A test imports the function and does not take this path.
if (typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined' && typeof chrome.alarms !== 'undefined') {
  void bootRovrServiceWorker();
}
