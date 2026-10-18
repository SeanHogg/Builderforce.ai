/**
 * Attach the credential a local endpoint needs, immediately before the call.
 *
 * The ONE place that decides this, because two surfaces make local requests — the chat
 * route (`modelRouting`) and the panel's host-performed fetch (`builderforcePanel`) — and a
 * second copy of "does this provider need a bearer, and where does a fresh one come
 * from?" is how one of them ends up sending a stale token or none at all.
 *
 * Kimi has two sources, tried in order:
 *   1. the Kimi Code CLI's own login on this machine (`~/.kimi-code`), refreshed in place —
 *      no Builderforce round trip at all;
 *   2. the WORKSPACE's Kimi connection (Settings → Model providers, or connected right here),
 *      whose short-lived access token the gateway issues and this editor persists. When
 *      the workspace has none, the person is offered the connect on the spot.
 *
 * An on-device engine passes straight through unauthenticated, which is what keeps a
 * signed-out editor able to run a local turn.
 */
import type * as vscode from "vscode";
import type { LocalEndpoint, LocalRuntimeId } from "@builderforce/local-inference";
import { currentKimiInstall } from "./gateway";
import { ensureFreshKimiToken } from "./kimiCodeAuth";
import { isKimiCodeInstall } from "./kimiCodeInstall";
import { ensureLocalProviderCredential } from "./providerConnect";
import nodeFs from "node:fs";

export type LocalEndpointAuthorization =
  | { ok: true; endpoint: LocalEndpoint }
  | { ok: false; detail: string };

/**
 * `endpoint` may be absent for Kimi: a pin made before any Kimi source existed on this
 * machine still has to reach the connect offer, and the workspace credential carries its
 * own base URL.
 */
export async function authorizeLocalEndpoint(
  provider: LocalRuntimeId,
  endpoint: LocalEndpoint | undefined,
  secrets: vscode.SecretStorage,
): Promise<LocalEndpointAuthorization> {
  if (provider !== "kimi-code") {
    return endpoint ? { ok: true, endpoint } : { ok: false, detail: `${provider} has no configured endpoint.` };
  }

  let cliDetail: string | null = null;
  const install = currentKimiInstall();
  if (isKimiCodeInstall(install)) {
    const resolved = await ensureFreshKimiToken(nodeFs, install.home);
    if (resolved.kind === "token") {
      return { ok: true, endpoint: { baseUrl: install.baseUrl, ...endpoint, token: resolved.accessToken } };
    }
    cliDetail = resolved.detail;
  }

  const outcome = await ensureLocalProviderCredential(secrets, "kimi", "Kimi");
  if (outcome.kind === "credential") {
    return { ok: true, endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken } };
  }
  const accountDetail = outcome.kind === "unavailable"
    ? outcome.detail
    : outcome.kind === "reconnect"
      ? outcome.detail
      : "No Kimi account is connected to this workspace.";
  return { ok: false, detail: cliDetail ? `${cliDetail} ${accountDetail}` : accountDetail };
}
