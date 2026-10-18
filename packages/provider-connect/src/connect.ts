/**
 * Connecting a provider SUBSCRIPTION through the gateway — the client half of
 * `api/src/presentation/routes/subscriptionOAuthRoutes.ts`:
 *
 *   POST /llm/provider-keys/:provider/oauth/start     → authorize URL + state (+ device user code)
 *   POST /llm/provider-keys/:provider/oauth/complete  → polled for a DEVICE grant until approved
 *
 * The server holds the device code and stores the tokens; the client only opens the page
 * and asks "approved yet?". Three hosts used to carry three copies of that loop and they
 * had drifted: the editor's swallowed `denied`/`expired` and kept polling a code that
 * could never approve for the full fifteen minutes, and ignored the provider's interval.
 */
import { errorDetail, field, stringField, type GatewayRequest } from './port';

/**
 * How long a device approval is waited for. Matched to the server's pending-record TTL
 * (`OAUTH_PKCE_TTL_SECONDS`, 15 minutes): past it the poll can only ever answer "start
 * again", so continuing would spin against an endpoint with nothing left to say.
 */
export const DEVICE_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

/** How much a `slow_down` widens the interval — RFC 8628 §3.5 says five seconds. */
const SLOW_DOWN_STEP_MS = 5000;

export interface ProviderConnectStart {
  /** `device`: approve on the page, nothing to paste. `paste`: the page shows a code to paste back. */
  grant: 'device' | 'paste';
  authorizeUrl: string;
  state: string;
  /** Shown so the person can confirm the page they landed on is the one this opened. */
  userCode: string | null;
  intervalMs: number;
}

/** Why a connect ended without a connection — each host maps these to its own sentence. */
export type ProviderConnectFailure = 'unavailable' | 'denied' | 'expired' | 'cancelled' | 'failed';

export class ProviderConnectError extends Error {
  constructor(readonly reason: ProviderConnectFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'ProviderConnectError';
  }
}

/** Begin a connect. Throws `unavailable` when the gateway cannot start one. */
export async function startProviderConnect(request: GatewayRequest, provider: string): Promise<ProviderConnectStart> {
  let res: { status: number; body: unknown };
  try {
    res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/oauth/start`, { method: 'POST' });
  } catch (error) {
    throw new ProviderConnectError('unavailable', error instanceof Error ? error.message : String(error));
  }
  if (res.status !== 200) throw new ProviderConnectError('unavailable', errorDetail(res.body, res.status));
  const authorizeUrl = stringField(res.body, 'authorizeUrl');
  const state = stringField(res.body, 'state');
  if (!authorizeUrl || !state) throw new ProviderConnectError('unavailable', 'malformed start response');
  const interval = Number(field(res.body, 'pollIntervalSeconds'));
  return {
    grant: stringField(res.body, 'grant') === 'device' ? 'device' : 'paste',
    authorizeUrl,
    state,
    userCode: stringField(res.body, 'userCode') || null,
    intervalMs: (Number.isFinite(interval) && interval > 0 ? interval : 5) * 1000,
  };
}

export interface DeviceApprovalDeps {
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Cancels the wait (the person closed the card, the component unmounted). */
  signal?: AbortSignal;
  /** Override for tests; defaults to {@link DEVICE_APPROVAL_WINDOW_MS}. */
  windowMs?: number;
}

/**
 * Poll `complete` until the person decides on the provider's page.
 *
 * Resolves once the server has stored the connection. `pending` keeps waiting,
 * `slow_down` widens the interval, a 400 is terminal (declined, or the code expired) and
 * a dropped request is retried — the device code is still valid while the window is open.
 */
export async function awaitDeviceApproval(
  request: GatewayRequest,
  provider: string,
  start: Pick<ProviderConnectStart, 'state' | 'intervalMs'>,
  deps: DeviceApprovalDeps,
): Promise<void> {
  const deadline = deps.now() + (deps.windowMs ?? DEVICE_APPROVAL_WINDOW_MS);
  let delay = Math.max(start.intervalMs, 1000);
  while (deps.now() < deadline) {
    if (deps.signal?.aborted) throw new ProviderConnectError('cancelled');
    await deps.sleep(delay);
    if (deps.signal?.aborted) throw new ProviderConnectError('cancelled');
    let res: { status: number; body: unknown };
    try {
      res = await request(`/llm/provider-keys/${encodeURIComponent(provider)}/oauth/complete`, {
        method: 'POST',
        json: { code: '', state: start.state },
      });
    } catch {
      continue;
    }
    if (res.status === 200) {
      if (field(res.body, 'ok') === true) return;
      const status = stringField(res.body, 'status');
      if (status === 'slow_down') delay += SLOW_DOWN_STEP_MS;
      continue;
    }
    const code = stringField(res.body, 'code');
    if (code === 'oauth_denied') throw new ProviderConnectError('denied', errorDetail(res.body, res.status));
    if (code === 'oauth_state_expired') throw new ProviderConnectError('expired', errorDetail(res.body, res.status));
    throw new ProviderConnectError('failed', errorDetail(res.body, res.status));
  }
  throw new ProviderConnectError('expired');
}
