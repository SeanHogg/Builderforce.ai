/**
 * Device sign-in (RFC 8628) — the ONE implementation the Chrome extension (Rovr,
 * `clients/chrome/src/sidepanel/SettingsView.tsx`) and the VS Code extension
 * (`clients/vscode/src/auth.ts`) both run, against the same endpoints:
 *
 *   POST /api/auth/device/code   → a code pair + the `/activate` page to approve it on
 *   POST /api/auth/device/token  → polled until the person approves; yields a `bfk_*`
 *                                  editor key bound to one workspace
 *   POST /api/auth/keys/revoke   → best-effort revoke of that key on sign-out
 *
 * It suits an extension better than a redirect-based OAuth flow: no redirect URI has to
 * be registered per extension id, the person approves in a normal tab where they are
 * already signed in, and the result is the credential the gateway already takes. The two
 * clients each used to carry their own copy of the polling loop, and the editor's had
 * already lost the "offline for a moment — keep polling" and `410 expired` handling.
 *
 * Host-neutral: fetch, the page opener and the clock are injected (tested with fakes).
 */

export interface DeviceAuthDeps {
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Open the approval page for the person. */
  openTab(url: string): Promise<void> | void;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The client name the approval page may show. */
  client: string;
}

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalMs: number;
  expiresAt: number;
}

export interface DeviceSignIn {
  accessKey: string;
  tenantId: number | null;
}

/** Why a sign-in ended without a key — each maps to its own localized message. */
export type DeviceAuthFailure = 'unavailable' | 'denied' | 'expired' | 'cancelled' | 'failed';

export class DeviceAuthError extends Error {
  constructor(readonly reason: DeviceAuthFailure, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'DeviceAuthError';
  }
}

/** Start a device login. Throws `unavailable` when the endpoint is absent or unhealthy. */
export async function startDeviceSignIn(deps: DeviceAuthDeps): Promise<DeviceCodeStart> {
  let res: Response;
  try {
    res = await deps.fetch(`${deps.baseUrl}/api/auth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: deps.client }),
    });
  } catch (e) {
    throw new DeviceAuthError('unavailable', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new DeviceAuthError('unavailable', `HTTP ${res.status}`);
  const body = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!body.device_code || !body.user_code || !body.verification_uri) throw new DeviceAuthError('unavailable', 'malformed response');
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: body.verification_uri_complete || body.verification_uri,
    intervalMs: Math.max(body.interval ?? 5, 1) * 1000,
    expiresAt: deps.now() + (body.expires_in ?? 600) * 1000,
  };
}

/**
 * Open the approval page and poll until the person decides. `signal` cancels the wait
 * (the person closed the sign-in card).
 */
export async function completeDeviceSignIn(
  deps: DeviceAuthDeps,
  start: DeviceCodeStart,
  signal?: AbortSignal,
): Promise<DeviceSignIn> {
  await deps.openTab(start.verificationUrl);
  let delay = start.intervalMs;
  while (deps.now() < start.expiresAt) {
    if (signal?.aborted) throw new DeviceAuthError('cancelled');
    await deps.sleep(delay);
    if (signal?.aborted) throw new DeviceAuthError('cancelled');
    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_code: start.deviceCode }),
      });
    } catch {
      // Offline for a moment — the code is still valid; keep polling until it expires.
      continue;
    }
    if (res.status === 200) {
      const body = (await res.json()) as { access_key?: string; tenant_id?: number };
      if (!body.access_key) throw new DeviceAuthError('failed', 'missing access_key');
      return { accessKey: body.access_key, tenantId: typeof body.tenant_id === 'number' ? body.tenant_id : null };
    }
    if (res.status === 428) continue; // authorization_pending
    if (res.status === 429) {
      delay += 2000; // slow_down
      continue;
    }
    if (res.status === 403) throw new DeviceAuthError('denied');
    if (res.status === 410) throw new DeviceAuthError('expired');
    throw new DeviceAuthError('failed', `HTTP ${res.status}`);
  }
  throw new DeviceAuthError('expired');
}

/** Best-effort server-side revoke of the key on sign-out (possession authorizes it). */
export async function revokeKey(deps: Pick<DeviceAuthDeps, 'baseUrl' | 'fetch'>, key: string): Promise<void> {
  try {
    await deps.fetch(`${deps.baseUrl}/api/auth/keys/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
  } catch {
    // Offline / endpoint absent — local sign-out still proceeds.
  }
}
