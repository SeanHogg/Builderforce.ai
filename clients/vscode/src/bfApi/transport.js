import * as vscode from "vscode";
import { NOT_SIGNED_IN } from "@seanhogg/builderforce-brain-embedded";
import { getBaseUrl } from "../gateway";
import { trackReachability } from "../outboxStorage";
import { exchangeJwt, tenantOfToken, workspaceTenantId } from "./session";
/**
 * The selected workspace cannot be acted in right now (its re-scope is parked: refused,
 * unreachable or timed out), so the request was NOT sent. Expected and self-healing — the
 * next exchange retries — so error reporting skips it ({@link isWorkspaceParked}).
 */
export class WorkspaceParkedError extends Error {
    code = "workspace_parked";
    constructor() {
        super(vscode.l10n.t("The workspace you selected can't be reached right now. BuilderForce will retry automatically."));
        this.name = "WorkspaceParkedError";
    }
}
/** Is this the expected parked-workspace refusal (not a defect worth filing)? */
export function isWorkspaceParked(error) {
    return typeof error === "object" && error !== null && error.code === "workspace_parked";
}
function assertActsAs(token, asTenant) {
    if (asTenant !== undefined && tenantOfToken(token) !== asTenant) {
        throw new WorkspaceParkedError();
    }
}
/** The workspace selected NOW; unknown means the request cannot be pinned to it, so it is refused. */
export function currentWorkspaceOrThrow() {
    const current = workspaceTenantId();
    if (current === undefined)
        throw new WorkspaceParkedError();
    return current;
}
const AUTHED_FETCH_TIMEOUT_MS = 60_000;
/**
 * The one authenticated fetch: JWT exchange, act-as assertion, and the 401
 * refresh-and-retry. Resolves `undefined` when there is no credential (signed
 * out, or the forced refresh yielded none) so `authed` can degrade quietly while
 * `authedRaw` turns it into NOT_SIGNED_IN.
 */
export async function fetchAuthed(secrets, path, authedInit) {
    const { asTenant: requested, ...init } = authedInit ?? {};
    const requestedTenant = requested ?? "current";
    let token = await exchangeJwt(secrets);
    if (!token)
        return undefined;
    const call = (t) => {
        // "current": the workspace selected NOW. A token that still acts as another tenant (a
        // re-scope that failed and fell back to the key's) must not be used.
        assertActsAs(t, requestedTenant === "any" ? undefined : requestedTenant === "current" ? currentWorkspaceOrThrow() : requestedTenant);
        return trackReachability(fetch(`${getBaseUrl()}${path}`, {
            ...init,
            // Unbounded, a server that never answers holds the caller for undici's 300 s default;
            // an upload (FormData) may legitimately run longer, so it is left to its caller.
            ...(init.signal || init.body instanceof FormData ? {} : { signal: AbortSignal.timeout(AUTHED_FETCH_TIMEOUT_MS) }),
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
        if (!token)
            return undefined;
        res = await call(token);
    }
    return res;
}
export async function authed(secrets, path, authedInit) {
    const res = await fetchAuthed(secrets, path, authedInit);
    if (!res)
        return undefined;
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Status rides ALONGSIDE the message (unchanged, so message-matching callers are
        // unaffected) because "is this worth retrying?" cannot be answered from prose.
        throw Object.assign(new Error(`${path} → HTTP ${res.status} ${body.slice(0, 160)}`), { status: res.status });
    }
    // 204 No Content (e.g. DELETE /api/tasks/:id) has no body to parse.
    if (res.status === 204)
        return undefined;
    return (await res.json());
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
export async function authedRaw(secrets, path, authedInit) {
    const res = await fetchAuthed(secrets, path, authedInit);
    if (!res)
        throw new Error(NOT_SIGNED_IN);
    const text = await res.text().catch(() => "");
    let body;
    try {
        body = text ? JSON.parse(text) : undefined;
    }
    catch {
        body = undefined;
    }
    return { status: res.status, body, text };
}
//# sourceMappingURL=transport.js.map