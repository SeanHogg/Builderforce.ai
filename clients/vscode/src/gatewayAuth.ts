import { getCurrentWorkspace } from "./workspaceSelection";

/**
 * The request header that tells the gateway WHICH workspace the editor key should act in.
 * The `bfk_*` key is bound to one tenant, but the user may have selected another workspace
 * they belong to; the gateway honours this header only for an editor key whose owner is an
 * active member of that workspace (api `WORKSPACE_HEADER`), and treats a value equal to the
 * key's own tenant as no override. The key itself stays the credential - usage rows and
 * telemetry attribution depend on it - so this is the ONLY thing that re-scopes a call.
 *
 * The current workspace is read from the vscode-free leaf `workspaceSelection.ts`, which the
 * session module keeps up to date; this module imports no session or vscode code.
 */
export const GATEWAY_WORKSPACE_HEADER = "x-builderforce-workspace";

/** The workspace header for a known workspace, or none. */
export function workspaceHeaderFor(workspace: number | undefined): Record<string, string> {
  return workspace === undefined ? {} : { [GATEWAY_WORKSPACE_HEADER]: String(workspace) };
}

/** {@link workspaceHeaderFor} for the editor's CURRENT workspace - read per request. */
export function gatewayWorkspaceHeaders(): Record<string, string> {
  return workspaceHeaderFor(getCurrentWorkspace());
}

/**
 * THE auth headers for a gateway (`/llm/*`) call made with the editor key: the Bearer key
 * plus the workspace. Every gateway fetch builds its headers here; never hand-roll
 * `authorization: Bearer ${key}` for a gateway call. `workspace` names the workspace
 * explicitly (a queued write replaying for the workspace it was queued in); omitted, it is
 * the current one.
 */
export function gatewayAuthHeaders(
  key: string,
  extra: Record<string, string> = {},
  workspace?: number,
): Record<string, string> {
  const workspaceHeader = workspace === undefined ? gatewayWorkspaceHeaders() : workspaceHeaderFor(workspace);
  return { ...extra, authorization: `Bearer ${key}`, ...workspaceHeader };
}

// -- Refusal classification ---------------------------------------------------
// The gateway refuses a workspace for one of two reasons, told apart by `code`:
//   - `editor_key_required`: THIS KEY can never switch workspaces (scoped, origin-bound,
//     not issued by device sign-in). Only a fresh sign-in fixes it.
//   - `workspace_not_member`: the key's owner is not (or no longer) a member of the SELECTED
//     workspace. The key is fine; the selection is stale and is dropped.
// Neither falls back to the key's own tenant: that would run the turn in the WRONG
// workspace. Detected ONCE, here, on every gateway response.

export type WorkspaceRefusal = "editor_key_required" | "workspace_not_member";

/** What a refusal listener is told: which refusal, and the key that was refused. */
export type WorkspaceRefusalEvent = {
  refusal: WorkspaceRefusal;
  key: string;
  /** The workspace the refused request NAMED (the header it sent), if any. */
  workspace?: number;
};

const refusalListeners = new Set<(event: WorkspaceRefusalEvent) => void>();

/** Subscribe to workspace refusals. Returns an unsubscribe. */
export function onWorkspaceRefused(listener: (event: WorkspaceRefusalEvent) => void): () => void {
  refusalListeners.add(listener);
  return () => { refusalListeners.delete(listener); };
}

/** Which workspace refusal (if any) does this status + body carry? */
export function classifyWorkspaceRefusal(status: number, body: unknown): WorkspaceRefusal | null {
  if (status !== 403 || typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return code === "editor_key_required" || code === "workspace_not_member" ? code : null;
}

/** Tell every listener a key was refused a workspace (from a gateway response or the `/api` re-scope). */
export function reportWorkspaceRefusal(refusal: WorkspaceRefusal, key: string, workspace?: number): void {
  for (const listener of [...refusalListeners]) listener({ refusal, key, ...(workspace !== undefined ? { workspace } : {}) });
}

/**
 * Pass a gateway response through, firing {@link onWorkspaceRefused} (with the key and
 * workspace the REQUEST carried, read from `requestHeaders`) when it is a workspace refusal. Reads a CLONE, so the caller's body is
 * untouched; never throws.
 */
export function observeGatewayResponse<R extends Response>(res: R, requestHeaders: Record<string, string>): R {
  if (res.status === 403) {
    void res.clone().json().then(
      (body: unknown) => {
        const refusal = classifyWorkspaceRefusal(res.status, body);
        if (!refusal) return;
        // The key and workspace are read from the headers the request SENT, not from state
        // that may have moved on by the time the answer arrives.
        const sentHeader = (name: string) =>
          Object.entries(requestHeaders).find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
        const key = sentHeader("authorization").replace(/^Bearer /, "");
        const sent = Number(sentHeader(GATEWAY_WORKSPACE_HEADER));
        reportWorkspaceRefusal(refusal, key, Number.isInteger(sent) && sent > 0 ? sent : undefined);
      },
      () => undefined,
    );
  }
  return res;
}
