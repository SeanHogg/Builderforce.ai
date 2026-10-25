/**
 * Attach the credential a local endpoint needs, immediately before the call.
 *
 * The ONE place that decides this, because two surfaces make local requests — the chat
 * route (`modelRouting`) and the panel's host-performed fetch (`localFetchProxy`) — and a
 * second copy of "does this provider need a bearer, and where does a fresh one come
 * from?" is how one of them ends up sending a stale token or none at all.
 *
 * Kimi has two sources, tried in order:
 *   1. the Kimi Code CLI's own login on this machine (`~/.kimi-code`), refreshed in place
 *      against the sign-in host that issued it (`oauth_host`) — no Builderforce round trip;
 *   2. the WORKSPACE's Kimi connection (Settings → Model providers, or connected right here),
 *      whose short-lived access token the gateway issues and this editor persists. When
 *      the workspace has none, the person is offered the connect on the spot.
 *
 * Every step's outcome is written to the BuilderForce output channel, and a failure is
 * filed as an error event: a Kimi turn that cannot be authorized must say which source
 * failed and why, never fall silently to somewhere else.
 *
 * An on-device engine passes straight through unauthenticated, which is what keeps a
 * signed-out editor able to run a local turn.
 */
import type * as vscode from "vscode";
import { localRuntime, type LocalEndpoint, type LocalRuntimeId } from "@builderforce/local-inference";
import { currentKimiInstall } from "./gateway";
import { ensureFreshKimiToken } from "./kimiCodeAuth";
import { isKimiCodeInstall } from "./kimiCodeInstall";
import { editorAccounts, ensureLocalProviderCredential } from "./providerConnect";
import { logLine, reportExtensionError } from "./errorReporter";
import nodeFs from "node:fs";

export type LocalEndpointAuthorization =
  | { ok: true; endpoint: LocalEndpoint }
  | { ok: false; detail: string };

const log = (line: string): void => logLine(`[kimi auth] ${line}`);

/**
 * `endpoint` may be absent for Kimi: a pin made before any Kimi source existed on this
 * machine still has to reach the connect offer, and the workspace credential carries its
 * own base URL.
 *
 * `interactive` is a turn about to run: only then is the sign-in offered and a failure filed.
 * A panel refresh or a scan resolves the same route quietly — prompting there re-rendered the
 * panel, which resolved again, and the loop reset the model pick.
 */
export async function authorizeLocalEndpoint(
  provider: LocalRuntimeId,
  endpoint: LocalEndpoint | undefined,
  secrets: vscode.SecretStorage,
  { interactive }: { interactive: boolean },
): Promise<LocalEndpointAuthorization> {
  if (provider !== "kimi-code") {
    return endpoint ? { ok: true, endpoint } : { ok: false, detail: `${provider} has no configured endpoint.` };
  }

  let cliDetail: string | null = null;
  const install = currentKimiInstall();
  if (isKimiCodeInstall(install)) {
    // Refresh at the host that issued the login: the other Kimi region answers a valid
    // grant with `invalid_grant`. An explicit environment override still wins.
    const env = install.oauthHost && !process.env.KIMI_CODE_OAUTH_HOST
      ? { ...process.env, KIMI_CODE_OAUTH_HOST: install.oauthHost }
      : process.env;
    const resolved = await ensureFreshKimiToken(nodeFs, install.home, { env });
    if (resolved.kind === "token") {
      if (interactive) log(`Kimi Code CLI login used (${install.home}, ${install.baseUrl}).`);
      return { ok: true, endpoint: { baseUrl: install.baseUrl, ...endpoint, token: resolved.accessToken } };
    }
    cliDetail = resolved.detail;
    if (interactive) log(`Kimi Code CLI login unusable (${resolved.kind}, sign-in host ${env.KIMI_CODE_OAUTH_HOST ?? "default"}): ${resolved.detail}`);
  } else if (interactive) {
    log(`No Kimi Code CLI login (${install.reason}): ${install.detail}`);
  }

  // The workspace's connected account for this runtime (registry `accountProvider`), through
  // the shared connected accounts — offering the sign-in when none is usable.
  const accountProvider = editorAccounts(secrets).providerFor(provider);
  if (!accountProvider) return { ok: false, detail: cliDetail ?? `${provider} has no connected account.` };
  const outcome = await ensureLocalProviderCredential(secrets, accountProvider, localRuntime(provider).label, { prompt: interactive });
  if (outcome.kind === "credential") {
    if (interactive) log(`Workspace Kimi connection used (${outcome.credential.baseUrl}).`);
    return { ok: true, endpoint: { baseUrl: outcome.credential.baseUrl, token: outcome.credential.accessToken } };
  }
  const accountDetail = outcome.kind === "unavailable"
    ? `The workspace Kimi connection could not be read (${outcome.detail}).`
    : outcome.kind === "reconnect"
      ? `The workspace Kimi connection needs to be renewed (${outcome.detail}).`
      : "No Kimi account is connected to this workspace.";
  const detail = cliDetail ? `${cliDetail} ${accountDetail}` : accountDetail;
  if (!interactive) return { ok: false, detail };
  void reportExtensionError(new Error(`Kimi could not be authorized: ${detail}`), {
    operation: "kimi.authorize",
    level: "warning",
    context: { cli: isKimiCodeInstall(install) ? "present" : install.reason, workspace: outcome.kind },
  });
  return { ok: false, detail };
}
