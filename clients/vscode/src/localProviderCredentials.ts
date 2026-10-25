/**
 * The editor's binding of the workspace's CONNECTED ACCOUNTS — the shared implementation in
 * `@builderforce/provider-connect/accounts` (the same one Rovr runs), persisted in
 * SecretStorage.
 *
 * Created on FIRST USE: there is no activation step, because there was once one that nothing
 * called, and every Kimi turn without a CLI login failed "credentials are not initialized"
 * with no sign-in offered.
 *
 * Kept free of the request layer on purpose: the synchronous model-config reader
 * (`gateway.getLocalModelsConfig`) needs {@link localCredentialSnapshot}, and the request
 * adapter sits above `bfApi`, which itself imports `gateway`. So the creator passes the
 * request in (`providerConnect.editorAccounts`) instead of this module importing it.
 */
import type * as vscode from "vscode";
import type { GatewayRequest, LocalCredential } from "@builderforce/provider-connect";
import { createConnectedAccounts, type ConnectedAccounts } from "@builderforce/provider-connect/accounts";

let accounts: ConnectedAccounts | undefined;
const listeners = new Set<() => void>();

/** The editor's connected accounts, created on first use. */
export function connectedAccounts(secrets: vscode.SecretStorage, request: () => GatewayRequest): ConnectedAccounts {
  accounts ??= createConnectedAccounts({
    request: request(),
    store: {
      get: (key) => Promise.resolve(secrets.get(key)),
      set: (key, value) => Promise.resolve(secrets.store(key, value)),
      delete: (key) => Promise.resolve(secrets.delete(key)),
    },
    now: Date.now,
    onChange: () => listeners.forEach((listener) => listener()),
  });
  return accounts;
}

/** Told whenever a credential arrives or is dropped — a surface re-reads its model list. */
export function onLocalCredentialsChange(listener: () => void): vscode.Disposable {
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

/** The last known credential's endpoint and models — synchronous, no I/O. Never send its
 *  token without `resolve()`: it may have expired. */
export function localCredentialSnapshot(provider: string): LocalCredential | null {
  return accounts?.store(provider).snapshot() ?? null;
}

/** Forget every locally held credential — sign-out, so the next account starts clean. */
export async function clearLocalProviderCredentials(): Promise<void> {
  await accounts?.clear();
}
