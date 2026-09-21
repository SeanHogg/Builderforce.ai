import * as vscode from "vscode";
import * as bfApi from "./bfApi";

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

/** Provider display information */
const PROVIDER_INFO: Record<string, { label: string; supportsOAuth: boolean }> = {
  anthropic: { label: "Anthropic (Claude)", supportsOAuth: true },
  openai: { label: "OpenAI", supportsOAuth: true },
  google: { label: "Google (Gemini)", supportsOAuth: false },
  meta: { label: "Meta AI (MUSE)", supportsOAuth: false },
  kimi: { label: "Kimi", supportsOAuth: true },
  moonshot: { label: "Moonshot AI", supportsOAuth: false },
  qwen: { label: "Qwen", supportsOAuth: false },
  minimax: { label: "MiniMax", supportsOAuth: false },
  xai: { label: "xAI (Grok)", supportsOAuth: true },
  ollama: { label: "Ollama Cloud", supportsOAuth: false },
};

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

/** Add a new provider connection via OAuth */
async function addProviderWithOAuth(
  secrets: vscode.SecretStorage,
  providerId: string,
): Promise<boolean> {
  const info = PROVIDER_INFO[providerId];
  if (!info || !info.supportsOAuth) return false;

  try {
    const oauth = await bfApi.startByoOAuth(secrets, providerId);
    if (!oauth) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("BuilderForce: could not start OAuth for {0}.", info.label),
      );
      return false;
    }

    const openAuth = vscode.l10n.t("Open authorization page");
    const pick = await vscode.window.showInformationMessage(
      vscode.l10n.t("BuilderForce: connect {0} in your browser.", info.label),
      openAuth,
    );

    if (pick === openAuth) {
      void vscode.env.openExternal(vscode.Uri.parse(oauth.authorizeUrl));

      if (oauth.grant === "device" && oauth.userCode) {
        // Device flow: show the user code and poll for completion
        void vscode.window.showInformationMessage(
          vscode.l10n.t("Enter this code on the authorization page: {0}", oauth.userCode),
        );

        // Poll for completion
        const maxAttempts = 90; // 15 minutes with 10s interval
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((resolve) => setTimeout(resolve, (oauth.pollIntervalSeconds ?? 10) * 1000));
          try {
            // For device flow, we poll with empty code - the server handles the device flow internally
            const result = await bfApi.completeByoOAuth(secrets, providerId, "", oauth.state);
            if (result?.ok) {
              void vscode.window.showInformationMessage(
                vscode.l10n.t("BuilderForce: connected {0}.", info.label),
              );
              return true;
            }
            if (result?.status === "slow_down") {
              // Continue polling with longer interval
              await new Promise((resolve) => setTimeout(resolve, 5000));
            }
            // If status is "pending", continue polling
          } catch {
            // Continue polling on error
          }
        }
        void vscode.window.showWarningMessage(
          vscode.l10n.t("BuilderForce: OAuth timed out for {0}.", info.label),
        );
      } else {
        // Paste flow: prompt for the authorization code
        const code = await vscode.window.showInputBox({
          title: vscode.l10n.t("Complete {0} connection", info.label),
          prompt: vscode.l10n.t("Paste the authorization code from the browser"),
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() ? undefined : vscode.l10n.t("Authorization code is required")),
        });

        if (code?.trim()) {
          const result = await bfApi.completeByoOAuth(secrets, providerId, code.trim(), oauth.state);
          if (result?.ok) {
            void vscode.window.showInformationMessage(
              vscode.l10n.t("BuilderForce: connected {0}.", info.label),
            );
            return true;
          }
        }
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("BuilderForce: could not connect {0} ({1}).", info.label, message),
    );
  }
  return false;
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
