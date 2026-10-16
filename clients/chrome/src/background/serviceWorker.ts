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
 */
import { createIndexedDbOutboxStore, createOnlineSignal } from '@builderforce/write-outbox';
import { createApiClient } from '../api/apiClient';
import { createSession } from '../auth/session';
import { DEFAULT_BASE_URL, ERROR_OUTBOX_DB, LOCAL_DB, SYNC_ALARM, SYNC_ALARM_MINUTES, SYNC_OUTBOX_DB } from '../config';
import { chromeKeyValue } from '../platform/keyValue';
import { createSettings } from '../platform/settings';
import { createIdbRecords } from '../store/idbRecords';
import { createChatSync, type SyncItem } from '../sync/chatSync';
import { isRovrRuntimeMessage, type SyncStats } from '../sync/runtimeMessages';
import type { ClientErrorEvent } from '../telemetry/errorEvents';
import { createErrorReports, REPORT_LANE } from '../telemetry/errorReports';

const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);

const local = chromeKeyValue('local');
const session = createSession({ storage: local, baseUrl: DEFAULT_BASE_URL, fetch: fetchImpl, now: Date.now });
const settings = createSettings(local);
const api = createApiClient({ session, baseUrl: DEFAULT_BASE_URL, fetch: fetchImpl });
const records = createIdbRecords(self.indexedDB, LOCAL_DB);

// Connectivity, from the worker's own events — the queue waits offline and replays on return.
const online = createOnlineSignal(self.navigator.onLine);
self.addEventListener('online', () => online.set(true));
self.addEventListener('offline', () => online.set(false));

const chatSync = createChatSync({
  api,
  records,
  store: createIndexedDbOutboxStore<SyncItem, number>({ indexedDB: self.indexedDB, dbName: SYNC_OUTBOX_DB, partition: 'chats' }),
  online,
  scope: () => session.scope(),
  taskProjectId: () => settings.taskProjectId(),
  onError: (error) => console.warn('Rovr sync: will retry', error),
});

const errorReports = createErrorReports({
  api,
  store: createIndexedDbOutboxStore<ClientErrorEvent, string>({ indexedDB: self.indexedDB, dbName: ERROR_OUTBOX_DB, partition: REPORT_LANE }),
  online,
  scope: () => session.scope(),
});

const flushAll = async (): Promise<void> => {
  await session.ready();
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
