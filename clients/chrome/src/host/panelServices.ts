/**
 * The side panel's COMPOSITION ROOT — the only place the run host meets `chrome`.
 * Everything here is a shared primitive bound to this browser: the local-first stream,
 * the device record, the durable step outbox, the browser tools behind the safety gate,
 * the action ledger, playbooks and the person's allow list. The React panel receives the
 * assembled services and renders them; it builds none of them.
 */
import { createLocalRuntimeProber, type LocalFirstAttemptRecord, type LocalRuntimeProbe } from '@builderforce/local-inference';
import { createOnlineSignal } from '@builderforce/write-outbox';
import { createPageEngineSet, installIndexedDbStepDurability, type PageEngineSet } from '@seanhogg/builderforce-brain-embedded';
import { bfiWebLoader } from '@seanhogg/builderforce-brain-embedded/bfi';
import { createApiClient, type ApiClient } from '../api/apiClient';
import { createSession, type Session } from '../auth/session';
import { BFI_WASM_FILE, DEFAULT_BASE_URL, LOCAL_DB, STEP_OUTBOX_DB } from '../config';
import { KIMI_API_ORIGINS, createConnectedAccount, type ConnectedAccount } from '../inference/connectedAccount';
import { loopbackEndpoints, resolveLoopbackProbes } from '../inference/localRuntimes';
import { createRovrStream } from '../inference/route';
import { createLocalFirstPersistence } from '../persistence/localFirstPersistence';
import { chromeKeyValue } from '../platform/keyValue';
import { createSettings, type RovrSettings } from '../platform/settings';
import { createSitePermissions, type SitePermissions } from '../platform/sitePermissions';
import { createPlaybookStore, renderPlaybooks, type PlaybookStore } from '../playbooks/playbooks';
import { buildRovrSystemPrompt } from '../prompt/systemPrompt';
import { createIdbRecords } from '../store/idbRecords';
import type { LocalTask, RovrRecords } from '../store/records';
import { runtimeSyncSink, type RovrRuntimeMessage, type SyncSink } from '../sync/runtimeMessages';
import { errorEvent } from '../telemetry/errorEvents';
import { createBrowserTools, createRovrToolRegistry } from '../tools/browserTools';
import { createChromeTabPort } from '../tools/chromeTabPort';
import { createActionLedger, type ActionLedger } from '../tools/ledger';
import { createPlatformCatalog, withPlatformTools } from '../tools/platformTools';
import { browserNeedsConfirm, type SafetyContext } from '../tools/safety';
import { createElementCache, createWorkingTab, type TabPort, type WorkingTab } from '../tools/tabPort';
import { createRovrRunHost, type RovrRunHost } from './rovrRunHost';
import { createRunOptions } from './runOptions';

export interface PanelServices {
  host: RovrRunHost;
  session: Session;
  api: ApiClient;
  records: RovrRecords;
  ledger: ActionLedger;
  playbooks: PlaybookStore;
  settings: RovrSettings;
  sites: SitePermissions;
  working: WorkingTab;
  tabs: TabPort;
  baseUrl: string;
  /** Allowed origins, kept current for the synchronous safety gate. */
  allowedOrigins(): ReadonlySet<string>;
  /** The safety context right now (the confirm card names the reasons from it). */
  safety(): SafetyContext;
  /** Add a task to a chat (the panel's own form and the agent's tool share this). */
  addTask(chatId: number, title: string, description: string): Promise<LocalTask>;
  /** Probe the on-device runtimes now (Settings → Refresh). */
  probeLocal(): Promise<LocalRuntimeProbe[]>;
  /** The side panel's in-page engines and their model store (the picker's downloads). */
  pageEngines: PageEngineSet;
  /** The workspace's Kimi account, called from this browser (Settings → Model, the Connect card). */
  kimi: ConnectedAccount;
  sendRuntime(message: RovrRuntimeMessage): Promise<unknown>;
  reportError(error: unknown, operation: string): void;
}

const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);

export async function createPanelServices(): Promise<PanelServices> {
  const baseUrl = DEFAULT_BASE_URL;
  const local = chromeKeyValue('local');
  const session = createSession({ storage: local, baseUrl, fetch: fetchImpl, now: Date.now });
  await session.ready();
  const settings = createSettings(local);
  const sites = createSitePermissions();
  const records = createIdbRecords(self.indexedDB, LOCAL_DB);
  const api = createApiClient({ session, baseUrl, fetch: fetchImpl });
  const sendRuntime = (message: RovrRuntimeMessage) => chrome.runtime.sendMessage(message);
  const sink: SyncSink = runtimeSyncSink(sendRuntime);
  const persistence = createLocalFirstPersistence(records, sink);
  const ledger = createActionLedger(records);
  const playbooks = createPlaybookStore(chromeKeyValue('sync'));
  const tabs = createChromeTabPort();
  const working = createWorkingTab();
  const cache = createElementCache();
  const release = chrome.runtime.getManifest().version;

  const reportError = (error: unknown, operation: string): void => {
    void sendRuntime({ type: 'rovr.error.report', event: errorEvent(error, { operation, release }) }).catch(() => undefined);
  };

  // The Brain loop's step rows: durable in IndexedDB, drained on open. Their sender is the
  // local-first record, which is always reachable — so the queue is always "online";
  // network connectivity gates the sync outbox (see `localFirstPersistence.ts`).
  installIndexedDbStepDurability({
    indexedDB: self.indexedDB,
    dbName: STEP_OUTBOX_DB,
    online: createOnlineSignal(true),
    scope: () => 'device',
    sendRows: (chatId, rows) => persistence.sendMessages(chatId, rows),
  });

  // ── The allow list, mirrored for the synchronous gate ─────────────────────────
  let allowed = new Set<string>(await sites.list());
  sites.subscribe(() => {
    void sites.list().then((list) => {
      allowed = new Set(list);
    });
  });

  // ── The working tab: the active tab of this panel's window ────────────────────
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = active?.windowId;
  if (active?.id !== undefined) working.set({ id: active.id, url: active.url ?? '' });
  chrome.tabs.onActivated.addListener(({ tabId, windowId: w }) => {
    if (w !== windowId) return;
    void chrome.tabs.get(tabId).then((t) => working.set({ id: tabId, url: t.url ?? '' }));
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url === undefined) return;
    cache.clear(tabId); // its refs belonged to the page that is gone
    if (working.current()?.id === tabId) working.set({ id: tabId, url: change.url });
  });
  // A closed working tab is not a page Rovr can act on. (Closing usually activates a
  // sibling, which `onActivated` reports; the last tab of a window does not.)
  chrome.tabs.onRemoved.addListener((tabId) => {
    cache.clear(tabId);
    if (working.current()?.id === tabId) working.set(null);
  });

  const safety = (): SafetyContext => {
    const tab = working.current();
    return { url: tab?.url ?? null, allowedOrigins: allowed, factsFor: (ref) => (tab ? cache.factsFor(tab.id, ref) : undefined) };
  };

  const addTask = async (chatId: number, title: string, description: string): Promise<LocalTask> => {
    const task: LocalTask = { id: crypto.randomUUID(), chatId, title, description, createdAt: new Date().toISOString(), state: 'queued' };
    await records.putTask(task);
    sink.enqueue(chatId, [{ kind: 'task', taskId: task.id }]);
    return task;
  };

  // ── Local first, failover to the gateway ───────────────────────────────────────
  const prober = createLocalRuntimeProber(fetchImpl, { capabilities: true });
  // The engines inside the panel (it has the Prompt API and WebGPU): Gemini Nano, WebLLM
  // and the WebGPU `bfi`, whose binary `build.mjs` copies into the extension root.
  const pageEngines = createPageEngineSet({ loadBfi: bfiWebLoader(() => chrome.runtime.getURL(BFI_WASM_FILE)) });
  const endpoints = async () => loopbackEndpoints(await settings.synapseUrl());
  const kimi = createConnectedAccount({
    api,
    storage: local,
    originGranted: () => chrome.permissions.contains({ origins: KIMI_API_ORIGINS }),
    now: Date.now,
  });
  await kimi.store.hydrate();
  // The token belongs to the signed-in workspace; the next sign-in may be someone else's.
  session.subscribe(() => {
    if (!session.isSignedIn()) void kimi.store.clear();
  });
  const stream = createRovrStream({
    baseUrl,
    fetch: fetchImpl,
    prober,
    endpoints,
    key: () => session.key(),
    page: { probe: () => pageEngines.probe(), fetch: pageEngines.fetch(fetchImpl) },
    // The side panel's model picker persists its pin here (Settings → Model).
    pinned: () => settings.pinnedModel(),
    accountPin: (ref) => kimi.pinFor(ref),
    onAttempt: (record: LocalFirstAttemptRecord) => {
      if (record.outcome !== 'served' && record.attempt.kind === 'local') {
        console.warn(`Rovr local-first: ${record.attempt.ref} ${record.outcome}${record.detail ? ` (${record.detail})` : ''}`);
      }
    },
  });

  // Signed in, the tenant's gateway MCP catalog joins the browser tools — read once a
  // minute at most for the life of the panel, writes behind the same approval card.
  const platform = createPlatformCatalog({
    baseUrl,
    key: () => session.key(),
    onError: (error) => reportError(error, 'platform.catalog'),
  });

  const host = createRovrRunHost({
    stream,
    persistence,
    history: (chatId) => records.listMessages(chatId),
    async catalog(chatId) {
      const tools = createBrowserTools({
        chatId,
        tabs,
        working,
        cache,
        ledger,
        addTask: (title, description) => addTask(chatId, title, description),
      });
      const { specs, run } = createRovrToolRegistry(tools);
      return withPlatformTools({ specs, run, needsConfirm: browserNeedsConfirm(safety) }, await platform.actions());
    },
    // The chat's `/` Work panel choices, read from its device record per run.
    runOptions: createRunOptions({
      getChat: (chatId) => records.getChat(chatId),
      api,
      signedIn: () => session.isSignedIn(),
      projectId: () => settings.taskProjectId(),
    }),
    async systemPrompt() {
      const tab = working.current();
      const title = tab ? ((await tabs.getTab(tab.id))?.title ?? '') : '';
      return buildRovrSystemPrompt({
        playbooks: renderPlaybooks(await playbooks.list(), tab?.url ?? null),
        tab: tab ? { url: tab.url, title } : null,
        allowedOrigins: [...allowed],
        now: new Date(),
      });
    },
    onDeclined(chatId, call) {
      const tab = working.current();
      void ledger.record(chatId, {
        tool: call.name,
        target: describeTarget(call.args),
        tabId: tab?.id ?? null,
        url: tab?.url ?? '',
        outcome: 'declined',
        detail: '',
      });
    },
  });

  return {
    host,
    session,
    api,
    records,
    ledger,
    playbooks,
    settings,
    sites,
    working,
    tabs,
    baseUrl,
    allowedOrigins: () => allowed,
    safety,
    addTask,
    probeLocal: async () => {
      const [probes, page] = await Promise.all([
        prober.probe(await endpoints(), { fresh: true }),
        pageEngines.probe({ fresh: true }),
      ]);
      return [...resolveLoopbackProbes(probes), ...page];
    },
    pageEngines,
    kimi,
    sendRuntime,
    reportError,
  };
}

/** A short target for a declined call — the URL, the ref, or the tool's first argument. */
function describeTarget(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  for (const key of ['url', 'ref', 'query', 'title']) if (typeof a[key] === 'string') return a[key] as string;
  return '';
}
