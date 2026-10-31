import type * as vscode from "vscode";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { getBaseUrl } from "../gateway";
import { trackReachability } from "../outboxStorage";
import { exchangeJwt, tenantOfToken } from "./session";

/**
 * A request init that may pin the tenant it must act as. A durable outbox replaying a
 * write passes the tenant the write was queued for; if the token at hand acts as any
 * other tenant the request is NOT sent — it fails (retriably) and the write waits.
 */
export type AuthedInit = RequestInit & { asTenant?: number };

function assertActsAs(token: string, asTenant: number | undefined): void {
  if (asTenant !== undefined && tenantOfToken(token) !== asTenant) {
    throw new Error(`tenant ${asTenant} is not the current workspace — write parked`);
  }
}

/**
 * The one authenticated fetch: JWT exchange, act-as assertion, and the 401
 * refresh-and-retry. Resolves `undefined` when there is no credential (signed
 * out, or the forced refresh yielded none) so `authed` can degrade quietly while
 * `authedRaw` turns it into NOT_SIGNED_IN.
 */
export async function fetchAuthed(
  secrets: vscode.SecretStorage,
  path: string,
  authedInit?: AuthedInit,
): Promise<Response | undefined> {
  const { asTenant, ...init } = authedInit ?? {};
  let token = await exchangeJwt(secrets);
  if (!token) return undefined;
  const call = (t: string) => {
    assertActsAs(t, asTenant);
    return trackReachability(fetch(`${getBaseUrl()}${path}`, {
      ...init,
      // A multipart body (an attachment upload) carries its own boundary in the header
      // fetch writes for it; forcing JSON there would make the body unreadable.
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${t}`,
        ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      },
    }));
  };
  let res = await call(token);
  if (res.status === 401) {
    token = await exchangeJwt(secrets, true);
    if (!token) return undefined;
    res = await call(token);
  }
  return res;
}

export async function authed<T>(
  secrets: vscode.SecretStorage,
  path: string,
  authedInit?: AuthedInit,
): Promise<T | undefined> {
  const res = await fetchAuthed(secrets, path, authedInit);
  if (!res) return undefined;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Status rides ALONGSIDE the message (unchanged, so message-matching callers are
    // unaffected) because "is this worth retrying?" cannot be answered from prose.
    throw Object.assign(new Error(`${path} → HTTP ${res.status} ${body.slice(0, 160)}`), { status: res.status });
  }
  // 204 No Content (e.g. DELETE /api/tasks/:id) has no body to parse.
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

/**
 * Like `authed`, but returns the raw status + parsed body instead of throwing on
 * non-2xx — used by dispatch where 202 (approval gate) and 402 (plan limit) are
 * meaningful, expected outcomes the caller must branch on, not failures. Reuses the
 * same JWT exchange + 401-retry as `authed` (DRY). Throws only on "not signed in".
 *
 * Exported for `errorReporter.ts`, which must treat 422 (no destination project)
 * and 429 (monthly cap) as "nothing more to do" rather than as a second error.
 */
export async function authedRaw<T>(
  secrets: vscode.SecretStorage,
  path: string,
  authedInit?: AuthedInit,
): Promise<{ status: number; body: T | undefined; text: string }> {
  const res = await fetchAuthed(secrets, path, authedInit);
  if (!res) throw new Error(NOT_SIGNED_IN);
  const text = await res.text().catch(() => "");
  let body: T | undefined;
  try {
    body = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body, text };
}
