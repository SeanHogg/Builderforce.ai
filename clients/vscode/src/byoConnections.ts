import * as vscode from "vscode";
import { LLM_PROVIDER_INFO } from "@builderforce/model-catalog";
import * as bfApi from "./bfApi";
import { connectProviderInteractively } from "./providerConnect";
import { LOCAL_CREDENTIAL_PROVIDERS, localCredentialStore, type LocalCredentialProvider } from "./localProviderCredentials";

/**
 * Manage BYO (bring-your-own) model provider connections from the editor.
 *
 * This allows workspace owners to connect their own frontier-model accounts
 * (Anthropic, OpenAI, Google, etc.) and use them instead of Builderforce's
 * metered pool. Connected providers unlock model choice on the free plan and
 * route calls through the tenant's own account (billed to them, not Builderforce).
 *
 * The flow mirrors the web settings panel: credentials never pass through the
 * editor, and OAuth consent opens in a real browser.
 */

/** Sentinel id for the "add a new provider" row in the picker. */
const ADD_PROVIDER = "__add__";

/**
 * Provider display information — derived from the shared BYO provider table so this
 * picker, the web settings page and the composer's Connected accounts can never name or
 * offer providers differently. Self-hosted runtimes connect from their own settings form.
 */
const PROVIDER_INFO: Record<string, { label: string; supportsOAuth: boolean }> = Object.fromEntries(
  LLM_PROVIDER_INFO
    .filter((p) => p.credential === "api_key")
    .map((p) => [p.id, { label: p.label, supportsOAuth: p.subscription !== null }]),
);

/** Describe a provider's connection status */
function describeProvider(provider: bfApi.ByoProvider): string {
  if (!provider.isConnected) {
    if (provider.error) return `⚠ ${provider.error}`;
    return vscode.l10n.t("Not connected");
  }
  if (provider.authType === "oauth" && provider.hasOauth) {
    return vscode.l10n.t("Connected via OAuth");
  }
  if (provider.hasApiKey) {
    return vscode.l10n.t("Connected via API key");
  }
  return vscode.l10n.t("Connected");
}

/** Get all available providers that can be added */
async function getAvailableProviders(
  secrets: vscode.SecretStorage,
): Promise<Array<{ id: string; label: string; supportsOAuth: boolean }>> {
  const connected = await bfApi.listByoProviders(secrets);
  const connectedIds = new Set(connected.map((p) => p.id));

  // Return providers that aren't yet connected
  return Object.entries(PROVIDER_INFO)
    .filter(([id]) => !connectedIds.has(id))
    .map(([id, info]) => ({ id, ...info }));
}

/** Add a new provider connection via API key */
async function addProviderWithKey(
  secrets: vscode.SecretStorage,
  providerId: string,
): Promise<boolean> {
  const info = PROVIDER_INFO[providerId];
  if (!info) return false;

  const apiKey = await vscode.window.showInputBox({
    title: vscode.l10n.t("Connect {0}", info.label),
    prompt: vscode.l10n.t("Enter your {0} API key", info.label),
    placeHolder: providerId === "anthropic" ? "sk-ant-…" : providerId === "google" ? "AIza…" : "sk-…",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("API key is required")),
  });

  if (!apiKey?.trim()) return false;

  try {
    const result = await bfApi.setByoProviderKey(secrets, providerId, apiKey.trim());
    if (result?.ok) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("BuilderForce: connected {0}.", info.label),
      );
      return true;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: could not connect {0} ({1}).", info.label, message),
    );
  }
  return false;
}

/**
 * Add a new provider connection via OAuth — the shared connect flow (`providerConnect.ts`),
 * the same one a turn runs when it needs an account. A provider this editor calls from
 * the machine (Kimi) also gets its credential persisted locally right away, so the next
 * turn needs no round trip.
 */
async function addProviderWithOAuth(
  secrets: vscode.SecretStorage,
  providerId: string,
): Promise<boolean> {
  const info = PROVIDER_INFO[providerId];
  if (!info || !info.supportsOAuth) return false;
  const connected = await connectProviderInteractively(secrets, providerId, info.label);
  if (connected) {
    const local = (LOCAL_CREDENTIAL_PROVIDERS as readonly string[]).includes(providerId)
      ? localCredentialStore(providerId as LocalCredentialProvider)
      : undefined;
    if (local) await local.resolve();
  }
  return connected;
}

/** Test an existing provider connection */
async function testConnection(secrets: vscode.SecretStorage, provider: bfApi.ByoProvider): Promise<void> {
  const info = PROVIDER_INFO[provider.id];
  const label = info?.label ?? provider.id;

  try {
    const result = await bfApi.testByoProvider(secrets, provider.id);
    if (result?.ok) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("BuilderForce: {0} connection is working.", label),
      );
    } else {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("BuilderForce: {0} connection failed: {1}", label, result?.error ?? "Unknown error"),
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: could not test {0} ({1}).", label, message),
    );
  }
}

/** Remove a provider connection */
async function removeConnection(secrets: vscode.SecretStorage, provider: bfApi.ByoProvider): Promise<void> {
  const info = PROVIDER_INFO[provider.id];
  const label = info?.label ?? provider.id;

  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t("BuilderForce: disconnect {0}? This will remove the connection.", label),
    { modal: true },
    vscode.l10n.t("Disconnect"),
  );

  if (confirm !== vscode.l10n.t("Disconnect")) return;

  try {
    const result = await bfApi.removeByoProvider(secrets, provider.id);
    if (result?.ok) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t("BuilderForce: disconnected {0}.", label),
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: could not disconnect {0} ({1}).", label, message),
    );
  }
}

/** Reconnect/re-authenticate an existing provider */
async function reconnectProvider(secrets: vscode.SecretStorage, provider: bfApi.ByoProvider): Promise<void> {
  const info = PROVIDER_INFO[provider.id];
  if (!info) return;

  // If it was connected via OAuth and supports OAuth, reconnect via OAuth
  if (info.supportsOAuth) {
    await addProviderWithOAuth(secrets, provider.id);
  } else {
    // Otherwise, ask for a new API key
    await addProviderWithKey(secrets, provider.id);
  }
}

/** QuickPickItem with an id property for tracking selections */
interface QuickPickItemWithId extends vscode.QuickPickItem {
  id: string;
  supportsOAuth?: boolean;
}

/**
 * The `builderforce.manageByoConnections` command: list configured BYO providers
 * and allow adding, testing, reconnecting, or removing them.
 */
export async function manageByoConnections(secrets: vscode.SecretStorage): Promise<void> {
  let providers: bfApi.ByoProvider[];
  try {
    providers = await bfApi.listByoProviders(secrets);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      /HTTP 403/.test(message)
        ? vscode.l10n.t("BuilderForce: only a workspace owner can manage connections.")
        : vscode.l10n.t("BuilderForce: could not load connections ({0}).", message),
    );
    return;
  }

  // Get available providers that can be added
  let availableProviders: Array<{ id: string; label: string; supportsOAuth: boolean }> = [];
  try {
    availableProviders = await getAvailableProviders(secrets);
  } catch {
    // Non-fatal - just means we can't show available providers
  }

  // Build quick pick items
  const items: QuickPickItemWithId[] = [];

  // Add "Add new provider" option if there are available providers
  if (availableProviders.length > 0) {
    items.push({
      label: vscode.l10n.t("$(add) Add model provider…"),
      id: ADD_PROVIDER,
      description: vscode.l10n.t("Connect a new BYO provider"),
    });
  }

  // Add existing providers
  for (const provider of providers) {
    const info = PROVIDER_INFO[provider.id];
    const label = info?.label ?? provider.id;
    const icon = provider.isConnected ? "$(check) " : "$(warning) ";
    items.push({
      label: `${icon}${label}`,
      description: describeProvider(provider),
      id: provider.id,
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t("BuilderForce: Model Provider Connections"),
    placeHolder: vscode.l10n.t("Select a provider to manage"),
  });

  if (!pick) return;

  const selectedId: string | undefined = pick.id;

  if (selectedId === ADD_PROVIDER) {
    // Show available providers to add
    const addPick = await vscode.window.showQuickPick(
      availableProviders.map((p) => ({
        label: p.supportsOAuth ? `$(key) ${p.label}` : `$(key) ${p.label}`,
        description: p.supportsOAuth
          ? vscode.l10n.t("API key or OAuth")
          : vscode.l10n.t("API key"),
        id: p.id,
        supportsOAuth: p.supportsOAuth,
      })),
      {
        title: vscode.l10n.t("Add Model Provider"),
        placeHolder: vscode.l10n.t("Select a provider to connect"),
      },
    );

    if (!addPick) return;

    if (addPick.supportsOAuth) {
      await addProviderWithOAuth(secrets, addPick.id);
    } else {
      await addProviderWithKey(secrets, addPick.id);
    }
    return;
  }

  // Find the selected provider
  const selectedProvider = providers.find((p) => p.id === selectedId);
  if (!selectedProvider) return;

  const info = PROVIDER_INFO[selectedProvider.id];
  const label = info?.label ?? selectedProvider.id;

  // Show action menu for the selected provider
  const action = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t("$(debug-alt) Test connection"),
        action: "test",
        description: vscode.l10n.t("Verify the connection is working"),
      },
      {
        label: vscode.l10n.t("$(refresh) Reconnect / Renew"),
        action: "reconnect",
        description: info?.supportsOAuth
          ? vscode.l10n.t("Re-authenticate via OAuth or enter new API key")
          : vscode.l10n.t("Enter a new API key"),
      },
      {
        label: vscode.l10n.t("$(trash) Disconnect"),
        action: "remove",
        description: vscode.l10n.t("Remove this provider connection"),
      },
    ],
    {
      title: vscode.l10n.t("{0} Connection", label),
      placeHolder: vscode.l10n.t("Select an action"),
    },
  );

  if (!action) return;

  switch (action.action) {
    case "test":
      await testConnection(secrets, selectedProvider);
      break;
    case "reconnect":
      await reconnectProvider(secrets, selectedProvider);
      break;
    case "remove":
      await removeConnection(secrets, selectedProvider);
      break;
  }
}
