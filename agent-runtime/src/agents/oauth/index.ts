/**
 * Native OAuth provider registry — the pi-free port of `@mariozechner/pi-ai`'s
 * `utils/oauth` (PI cutover). Faithful copy of pi 0.54's 5 OAuth providers
 * (anthropic / github-copilot / google-antigravity / google-gemini-cli / openai-codex):
 * `id` + token `refreshToken` (provider token endpoints) + `getApiKey`. `getOAuthApiKey`
 * refreshes expired credentials then returns the API key. Login/device flows live in
 * `./codex.ts` (the only one the on-prem CLI invokes). Live auth verification owed.
 */

import type { OAuthCredentials } from "../../builderforce/model/types.js";
import { loginOpenAICodex, refreshOpenAICodexToken } from "./codex.js";

export { loginOpenAICodex, refreshOpenAICodexToken } from "./codex.js";

export interface OAuthProviderInterface {
  readonly id: string;
  readonly name: string;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
}

const decode = (s: string): string => atob(s);

// ── Anthropic (Claude Pro/Max) ───────────────────────────────────────────────
const ANTHROPIC_CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: ANTHROPIC_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`Anthropic token refresh failed: ${await response.text()}`);
  const data = (await response.json()) as {
    refresh_token: string;
    access_token: string;
    expires_in: number;
  };
  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

// ── GitHub Copilot ───────────────────────────────────────────────────────────
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};
export async function refreshGitHubCopilotToken(
  refreshToken: string,
  enterpriseDomain?: string,
): Promise<OAuthCredentials> {
  const domain = enterpriseDomain || "github.com";
  const copilotTokenUrl = `https://api.${domain}/copilot_internal/v2/token`;
  const response = await fetch(copilotTokenUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${refreshToken}`,
      ...COPILOT_HEADERS,
    },
  });
  if (!response.ok) throw new Error(`Copilot token refresh failed: ${await response.text()}`);
  const raw = (await response.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof raw.token !== "string" || typeof raw.expires_at !== "number")
    throw new Error("Invalid Copilot token response fields");
  return {
    refresh: refreshToken,
    access: raw.token,
    expires: raw.expires_at * 1000 - 5 * 60 * 1000,
    enterpriseUrl: enterpriseDomain,
  };
}

// ── Google (Antigravity + Gemini CLI) — same token endpoint, different client ──
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
async function refreshGoogleToken(
  refreshToken: string,
  projectId: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthCredentials> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed: ${await response.text()}`);
  const data = (await response.json()) as {
    refresh_token?: string;
    access_token: string;
    expires_in: number;
  };
  return {
    refresh: data.refresh_token || refreshToken,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId,
  };
}
const ANTIGRAVITY_CLIENT_ID = decode(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const ANTIGRAVITY_CLIENT_SECRET = decode("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const GEMINI_CLIENT_ID = decode(
  "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const GEMINI_CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
export const refreshAntigravityToken = (refreshToken: string, projectId: string) =>
  refreshGoogleToken(refreshToken, projectId, ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET);
export const refreshGoogleCloudToken = (refreshToken: string, projectId: string) =>
  refreshGoogleToken(refreshToken, projectId, GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET);

const googleGetApiKey = (c: OAuthCredentials): string =>
  JSON.stringify({ token: c.access, projectId: (c as { projectId?: string }).projectId });

// ── Registry ─────────────────────────────────────────────────────────────────
const providers: OAuthProviderInterface[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude Pro/Max)",
    refreshToken: (c) => refreshAnthropicToken(c.refresh),
    getApiKey: (c) => c.access,
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    refreshToken: (c) =>
      refreshGitHubCopilotToken(c.refresh, (c as { enterpriseUrl?: string }).enterpriseUrl),
    getApiKey: (c) => c.access,
  },
  {
    id: "google-gemini-cli",
    name: "Google Cloud Code Assist (Gemini CLI)",
    refreshToken: (c) => {
      const projectId = (c as { projectId?: string }).projectId;
      if (!projectId) throw new Error("Google Cloud credentials missing projectId");
      return refreshGoogleCloudToken(c.refresh, projectId);
    },
    getApiKey: googleGetApiKey,
  },
  {
    id: "google-antigravity",
    name: "Antigravity (Gemini 3, Claude, GPT-OSS)",
    refreshToken: (c) => {
      const projectId = (c as { projectId?: string }).projectId;
      if (!projectId) throw new Error("Antigravity credentials missing projectId");
      return refreshAntigravityToken(c.refresh, projectId);
    },
    getApiKey: googleGetApiKey,
  },
  {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    refreshToken: (c) => refreshOpenAICodexToken(c.refresh),
    getApiKey: (c) => c.access,
  },
];

const registry = new Map<string, OAuthProviderInterface>(providers.map((p) => [p.id, p]));

export function getOAuthProvider(id: string): OAuthProviderInterface | undefined {
  return registry.get(id);
}

export function getOAuthProviders(): OAuthProviderInterface[] {
  return Array.from(registry.values());
}

/** Resolve an API key from OAuth credentials, refreshing if expired (port of pi's `getOAuthApiKey`). */
export async function getOAuthApiKey(
  providerId: string,
  credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
  let creds = credentials[providerId];
  if (!creds) return null;
  if (Date.now() >= creds.expires) {
    try {
      creds = await provider.refreshToken(creds);
    } catch {
      throw new Error(`Failed to refresh OAuth token for ${providerId}`);
    }
  }
  return { newCredentials: creds, apiKey: provider.getApiKey(creds) };
}
