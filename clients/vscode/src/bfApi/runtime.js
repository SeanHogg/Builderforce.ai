import { authed, authedRaw } from "./transport";
const EMPTY_ATTENTION = { tasks: {}, chats: {}, counts: { running: 0, awaiting: 0 }, manager: { lastRunAt: null, recentlyActive: false } };
/**
 * Fetch the tenant's live "what's running / what needs a human answer" map — the
 * SAME signal the web app renders, so the Sessions and Project trees light up in
 * lockstep with the board and the browser. Scoped to `projectId` when given.
 * Degrades to an empty map when signed out / unreachable (never throws).
 */
/** The live map, or `null` when the gateway could not be reached — the poller
 *  keeps its last map and backs off, rather than painting every session idle
 *  and asking again in eight seconds. An unauthenticated read is an EMPTY map,
 *  not a failure: there is genuinely nothing live for this person. */
export async function getAttention(secrets, projectId, 
/** Skip the server's cached snapshot — only when the caller knows state just moved. */
fresh = false) {
    try {
        const params = new URLSearchParams();
        if (projectId != null)
            params.set("projectId", String(projectId));
        if (fresh)
            params.set("fresh", "1");
        const q = params.size > 0 ? `?${params.toString()}` : "";
        const r = await authed(secrets, `/api/runtime/attention${q}`);
        return r ?? EMPTY_ATTENTION;
    }
    catch {
        return null;
    }
}
/**
 * A failed platform dispatch, carrying the structured detail the command layer needs
 * to show a SPECIFIC, actionable message instead of the raw HTTP dump. `httpStatus`
 * branches the outcome (402 → run-limit upgrade, 429 → token-budget), `code` is the
 * gateway's machine code (e.g. `plan_token_limit_exceeded`), and `serverMessage` is
 * the human-readable reason the API already tailored to the tenant's plan.
 */
export class BfDispatchError extends Error {
    httpStatus;
    code;
    serverMessage;
    constructor(message, detail) {
        super(message);
        this.name = "BfDispatchError";
        this.httpStatus = detail.httpStatus;
        this.code = detail.code;
        this.serverMessage = detail.serverMessage;
    }
}
/**
 * Dispatch a PLATFORM run for a task — the SAME endpoint the web app's
 * `runtimeApi.submitExecution` hits (POST /api/runtime/executions). This is DISTINCT
 * from the local in-editor agent loop: it asks the platform to run the task on its
 * assigned AgentHost / cloud agent. The run is then observable on the board / web app.
 *
 * Returns either the started execution (HTTP 201) or, when a priority/policy gate fires,
 * an `awaitingApproval` descriptor (HTTP 202). On any other status throws a
 * {@link BfDispatchError} carrying the HTTP status, the gateway's machine `code`, and
 * the server's tailored message so the command layer can branch (402 → run-limit
 * upgrade, 429 → token-budget) and show the specific reason.
 */
export async function submitExecution(secrets, taskId, opts) {
    const { status, body, text } = await authedRaw(secrets, "/api/runtime/executions", {
        method: "POST",
        body: JSON.stringify({ taskId, ...opts }),
    });
    if (status === 202 && body?.approvalId) {
        return { awaitingApproval: { approvalId: body.approvalId, taskId, reason: body.reason } };
    }
    if (status === 201 || status === 200) {
        return { execution: body };
    }
    // Non-2xx: hand the command layer structured detail (status + code + the server's
    // tailored message) instead of a raw dump. Falls back to the verbatim status line
    // when the body carried no JSON `error` (e.g. an infra 5xx).
    const serverMessage = typeof body?.error === "string" ? body.error : undefined;
    throw new BfDispatchError(serverMessage ?? `/api/runtime/executions → HTTP ${status} ${text.slice(0, 200)}`, { httpStatus: status, code: typeof body?.code === "string" ? body.code : undefined, serverMessage });
}
/**
 * List human-in-the-loop approvals for the active tenant — the SAME endpoint the web
 * HumanRequestsView uses (GET /api/approvals). Defaults to `pending`. Optionally narrows
 * to one on-prem agent host. Degrades to [] when the endpoint isn't deployed.
 */
export async function listHumanRequests(secrets, opts) {
    const status = opts?.status ?? "pending";
    const params = new URLSearchParams();
    if (status)
        params.set("status", status);
    if (opts?.agentHostId != null)
        params.set("agentHostId", String(opts.agentHostId));
    const qs = params.toString();
    try {
        const r = await authed(secrets, `/api/approvals${qs ? `?${qs}` : ""}`);
        return r?.approvals ?? [];
    }
    catch {
        return [];
    }
}
/**
 * Resolve a human-in-the-loop request — the SAME endpoint the web ApprovalResolveControl
 * uses (PATCH /api/approvals/:id). `decision` maps to the backend status:
 *   - "approve" → "approved", "reject" → "rejected" (kind: approval)
 *   - "answer"  → "answered" (kind: question/feedback; requires `note` as responseText)
 * `note` is the review note for approve/reject, or the answer text for "answer".
 * Returns the updated approval (may carry `startedExecutionId` when an approval started a run).
 */
export async function resolveHumanRequest(secrets, id, decision, note) {
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "answered";
    const payload = { status };
    if (decision === "answer")
        payload.responseText = note ?? "";
    else if (note)
        payload.reviewNote = note;
    const r = await authed(secrets, `/api/approvals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (!r)
        throw new Error("not signed in");
    return r;
}
//# sourceMappingURL=runtime.js.map