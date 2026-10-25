/**
 * The tenant's CONNECTED provider accounts, as every chat surface shows them — the
 * client half of `api/src/presentation/routes/llm/providerKeyRoutes.ts`:
 *
 *   GET  /llm/provider-keys                  → each connected provider + any dispatch-observed alert
 *   POST /llm/provider-keys/:provider/test   → one strict-pinned probe; writes or clears that alert
 *
 * plus the paste half of a subscription connect ({@link completePasteConnect}); the start and
 * the device poll are `connect.ts`. {@link createProviderConnectionsClient} bundles all of it
 * behind ONE object so a host hands the composer's Status tab a single port instead of five
 * functions, and the tab can read status and reconnect without leaving the chat.
 */
import { isLlmProvider, llmProviderInfo } from '@builderforce/model-catalog';
import {
  ProviderConnectError,
  awaitDeviceApproval,
  startProviderConnect,
  type DeviceApprovalDeps,
  type ProviderConnectStart,
} from './connect.js';
import { errorDetail, field, stringField, type GatewayRequest } from './port.js';

/**
 * What the last dispatch (or probe) said about a connection. Mirrors the gateway's
 * `ProviderAuthAlertReason`, with `ok` for "no alert":
 *  - `capacity`: valid credential, the ACCOUNT is out of allowance or credits — reconnecting cannot help;
 *  - `not_entitled`: signed in, but the plan does not cover the model — a different account or plan helps;
 *  - `rejected`: the credential itself was refused (expired, revoked) — reconnect;
 *  - `unresolved`: the stored credential could not even be read or refreshed — reconnect.
 */
export type ConnectionHealth = 'ok' | 'capacity' | 'not_entitled' | 'rejected' | 'unresolved';

const ALERT_HEALTH: Readonly<Record<string, ConnectionHealth>> = {
  capacity: 'capacity',
  not_entitled: 'not_entitled',
  rejected: 'rejected',
  unresolved: 'unresolved',
};

/** An alert's verdict. An alert with a reason this client does not know still means "not working". */
export function connectionHealth(alert: unknown): ConnectionHealth {
  if (!alert || typeof alert !== 'object') return 'ok';
  return ALERT_HEALTH[stringField(alert, 'reason')] ?? 'rejected';
}

export interface ProviderConnection {
  provider: string;
  /** Brand name from the shared provider table — literal, never translated. */
  label: string;
  authType: 'oauth' | 'api_key';
  health: ConnectionHealth;
  /** A subscription connect can be run again from the chat; an API key is replaced in settings. */
  reconnectable: boolean;
}

function toConnection(detail: unknown): ProviderConnection | null {
  const provider = stringField(detail, 'provider');
  if (!provider) return null;
  const authType = stringField(detail, 'authType') === 'oauth' ? 'oauth' : 'api_key';
  const known = isLlmProvider(provider) ? llmProviderInfo(provider) : null;
  return {
    provider,
    label: known?.label ?? provider,
    authType,
    health: connectionHealth(field(detail, 'authAlert')),
    reconnectable: authType === 'oauth' && !!known?.subscription,
  };
}

/**
 * The connected accounts, in the tenant's precedence order. `null` when the gateway
 * refuses this caller the list (403 — e.g. a key whose origin allowlist excludes it), so
 * a surface can say the section is unavailable rather than report a fault.
 */
export async function listProviderConnections(request: GatewayRequest): Promise<ProviderConnection[] | null> {
  const res = await request('/llm/provider-keys');
  if (res.status === 403) return null;
  if (res.status !== 200) throw new Error(errorDetail(res.body, res.status));
  const details = field(res.body, 'details');
  return Array.isArray(details)
    ? details.map(toConnection).filter((c): c is ProviderConnection => c !== null)
    : [];
}

export interface ProviderTestResult {
  ok: boolean;
  /**
   * The verdict the probe just persisted, so a row repaints without another read — or
   * null when it persisted none (a transient failure, or a probe that never dispatched),
   * in which case the account's standing verdict is unchanged.
   */
  health: ConnectionHealth | null;
  /** The gateway's sentence for a failed probe (what failed, and what to do). */
  message: string | null;
}

/** Run the connection probe — the same one the settings card's Test button and the daily sweep run. */
export async function testProviderConnection(request: GatewayRequest, provider: string): Promise<ProviderTestResult> {
  const res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/test`, { method: 'POST' });
  if (res.status === 200 && field(res.body, 'ok') === true) return { ok: true, health: 'ok', message: null };
  const alert = field(res.body, 'authAlert');
  return {
    ok: false,
    health: alert ? connectionHealth(alert) : null,
    message: errorDetail(res.body, res.status),
  };
}

/**
 * Redeem what the provider's page showed for a `paste` grant. A code the provider will
 * never accept again (spent, expired) or a consent session that is gone both end as
 * `expired` — the only remedy is starting over — and anything else as `failed`.
 */
export async function completePasteConnect(
  request: GatewayRequest,
  provider: string,
  code: string,
  state: string,
): Promise<void> {
  let res: { status: number; body: unknown };
  try {
    res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/oauth/complete`, {
      method: 'POST',
      json: { code, ...(state ? { state } : {}) },
    });
  } catch (error) {
    // No answer at all — the code and state are still good, so this is retryable, not a failed start.
    throw new ProviderConnectError('failed', error instanceof Error ? error.message : String(error));
  }
  if (res.status === 200 && field(res.body, 'ok') === true) return;
  const errorCode = stringField(res.body, 'code');
  if (errorCode === 'oauth_code_spent' || errorCode === 'oauth_state_expired') {
    throw new ProviderConnectError('expired', errorDetail(res.body, res.status));
  }
  throw new ProviderConnectError('failed', errorDetail(res.body, res.status));
}

/** Everything a surface needs to show connections and reconnect one, over ONE gateway port. */
export interface ProviderConnectionsClient {
  list(): Promise<ProviderConnection[] | null>;
  test(provider: string): Promise<ProviderTestResult>;
  start(provider: string): Promise<ProviderConnectStart>;
  completePaste(provider: string, code: string, state: string): Promise<void>;
  awaitDevice(provider: string, start: ProviderConnectStart, signal: AbortSignal): Promise<void>;
}

export function createProviderConnectionsClient(
  request: GatewayRequest,
  clock: Pick<DeviceApprovalDeps, 'sleep' | 'now'> = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  },
): ProviderConnectionsClient {
  return {
    list: () => listProviderConnections(request),
    test: (provider) => testProviderConnection(request, provider),
    start: (provider) => startProviderConnect(request, provider),
    completePaste: (provider, code, state) => completePasteConnect(request, provider, code, state),
    awaitDevice: (provider, start, signal) => awaitDeviceApproval(request, provider, start, { ...clock, signal }),
  };
}
