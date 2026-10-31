import type * as vscode from "vscode";
import { authed } from "./transport";
import { getCurrentWorkspace } from "./workspace";

// ---------------------------------------------------------------------------
// BYO provider connections (bring-your-own model provider accounts)
// ---------------------------------------------------------------------------

/** A configured BYO model provider. */
export interface ByoProvider {
  /** Provider key (anthropic, openai, google, etc.) */
  id: string;
  /** Display name */
  label: string;
  /** How the provider is authenticated (api_key, oauth, etc.) */
  authType: "api_key" | "oauth" | "none";
  /** Whether the connection is currently working */
  isConnected: boolean;
  /** Last error message if not connected */
  error?: string;
  /** API key is configured (masked value not returned) */
  hasApiKey: boolean;
  /** OAuth is connected */
  hasOauth: boolean;
}

/** Result of testing a provider connection */
interface ByoProviderTestResult {
  ok: boolean;
  provider: string;
  error?: string;
}

/**
 * List the tenant's configured BYO model providers.
 * Returns the providers that have credentials configured (API key or OAuth).
 */
export async function listByoProviders(secrets: vscode.SecretStorage): Promise<ByoProvider[]> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return [];
  try {
    // `providers` is the bare id array kept for older clients; the per-provider facts are
    // in `details`. Reading `providers` as objects (as this did) made every connection's
    // id `undefined`, so the editor offered to "add" providers that were already connected
    // and never showed how a connected one authenticates.
    const r = await authed<{
      details?: Array<{ provider: string; authType?: "api_key" | "oauth"; authAlert?: { reason?: string; status?: number } }>;
    }>(secrets, `/llm/provider-keys`);
    return (r?.details ?? []).map((d) => ({
      id: d.provider,
      label: d.provider,
      authType: d.authType ?? "api_key",
      isConnected: !d.authAlert,
      ...(d.authAlert ? { error: `${d.authAlert.reason ?? "rejected"} (HTTP ${d.authAlert.status ?? 0})` } : {}),
      hasApiKey: d.authType !== "oauth",
      hasOauth: d.authType === "oauth",
    }));
  } catch {
    return [];
  }
}

/**
 * Set an API key for a BYO provider.
 */
export async function setByoProviderKey(
  secrets: vscode.SecretStorage,
  provider: string,
  apiKey: string,
): Promise<{ ok: boolean; provider: string } | undefined> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return undefined;
  return authed<{ ok: boolean; provider: string }>(secrets, `/llm/provider-keys/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

/**
 * Remove a BYO provider connection.
 */
export async function removeByoProvider(secrets: vscode.SecretStorage, provider: string): Promise<{ ok: boolean } | undefined> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return undefined;
  return authed<{ ok: boolean }>(secrets, `/llm/provider-keys/${provider}`, {
    method: "DELETE",
  });
}

/**
 * Test a BYO provider connection.
 */
export async function testByoProvider(
  secrets: vscode.SecretStorage,
  provider: string,
): Promise<ByoProviderTestResult | undefined> {
  const ws = await getCurrentWorkspace(secrets);
  if (!ws) return undefined;
  return authed<ByoProviderTestResult>(secrets, `/llm/provider-keys/${provider}/test`, {
    method: "POST",
  });
}
