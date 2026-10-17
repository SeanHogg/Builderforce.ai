/**
 * Rovr's fixed coordinates — where the platform is, what its stores are called, and the
 * identity it reports under. One module, so no other file spells an origin or a database
 * name (the manifest's `host_permissions` must list the same origins; `config.test.ts`
 * holds them together).
 */

/**
 * The gateway base. The primary domain's same-origin gateway path, exactly as the VS Code
 * extension defaults to (`builderforce.baseUrl`): it reaches the API on networks that
 * allow the main site but block the `api.` subdomain.
 */
export const DEFAULT_BASE_URL = 'https://builderforce.ai/gateway';

/** The origins Rovr talks to without asking — mirrored by the manifest's `host_permissions`. */
export const PLATFORM_ORIGINS = ['https://builderforce.ai', 'https://api.builderforce.ai'] as const;
/** Where an upgrade click lands — the web app's `/pricing` IS its billing console, for a
 *  free workspace choosing a tier and a paid one managing its plan alike. */
export const PRICING_URL = `${PLATFORM_ORIGINS[0]}/pricing`;
/** On-device inference runs on loopback — also in `host_permissions`. */
export const LOOPBACK_ORIGINS = ['http://127.0.0.1', 'http://localhost'] as const;

/** The WebGPU `bfi` engine's binary, copied to the extension root by `build.mjs` under the
 *  vendored file's own name (`packages/bfi-web`); the panel loads it from
 *  `chrome.runtime.getURL(BFI_WASM_FILE)`. */
export const BFI_WASM_FILE = 'bfi_web_bg.wasm';

/** The client name sent with a device sign-in (`POST /api/auth/device/code`). */
export const DEVICE_CLIENT = 'chrome';

/** `source` on `POST /api/quality-ingest/client-report` (api `CLIENT_REPORT_SOURCES`). */
export const CLIENT_REPORT_SOURCE = 'chrome-extension';

/** IndexedDB: the network sync outbox (chat rows, tasks) — owned by the service worker. */
export const SYNC_OUTBOX_DB = 'builderforce-outbox:rovr';
/** IndexedDB: the Brain loop's step queues (brain-embedded step durability) — the panel's. */
export const STEP_OUTBOX_DB = 'builderforce-outbox:rovr-steps';
/** IndexedDB: client error reports waiting to be filed. */
export const ERROR_OUTBOX_DB = 'builderforce-outbox:rovr-errors';
/** IndexedDB: the local-first record — chats, messages, tasks, the action ledger. */
export const LOCAL_DB = 'rovr';

/** The alarm that wakes the service worker to replay a backlog. */
export const SYNC_ALARM = 'rovr-sync';
/** Minutes between those wakes (Chrome's floor for a packed extension is 0.5). */
export const SYNC_ALARM_MINUTES = 1;
