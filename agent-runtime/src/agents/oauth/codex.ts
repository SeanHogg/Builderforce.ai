/**
 * OpenAI Codex (ChatGPT OAuth) — native port of `@mariozechner/pi-ai`'s
 * `utils/oauth/openai-codex.js` + `pkce.js` (PI cutover). CLI-only (uses node:crypto +
 * node:http for the OAuth callback). Faithful copy of pi 0.54's PKCE authorization-code
 * flow + token refresh; live auth verification owed (no OAuth endpoints in CI).
 */

import type { OAuthCredentials } from "../../builderforce/model/types.js";

let _randomBytes: ((n: number) => { toString(enc: string): string }) | null = null;
let _http: typeof import("node:http") | null = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  import("node:crypto").then((m) => {
    _randomBytes = m.randomBytes as unknown as typeof _randomBytes;
  });
  import("node:http").then((m) => {
    _http = m;
  });
}

// ── PKCE (port of pi's pkce.js) ──────────────────────────────────────────────
function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const SUCCESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Authentication successful</title></head>
<body><p>Authentication successful. Return to your terminal to continue.</p></body></html>`;

interface TokenResult {
  type: "success" | "failed";
  access?: string;
  refresh?: string;
  expires?: number;
}

function createState(): string {
  if (!_randomBytes)
    throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
  return _randomBytes(16).toString("hex");
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    /* not a URL */
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
  }
  return { code: value };
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1] ?? "")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri = REDIRECT_URI,
): Promise<TokenResult> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) return { type: "failed" };
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number")
    return { type: "failed" };
  return {
    type: "success",
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    if (!response.ok) return { type: "failed" };
    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number")
      return { type: "failed" };
    return {
      type: "success",
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    };
  } catch {
    return { type: "failed" };
  }
}

async function createAuthorizationFlow(
  originator = "pi",
): Promise<{ verifier: string; state: string; url: string }> {
  const { verifier, challenge } = await generatePKCE();
  const state = createState();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", originator);
  return { verifier, state, url: url.toString() };
}

interface LocalServer {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
}

function startLocalOAuthServer(state: string): Promise<LocalServer> {
  if (!_http) throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
  let lastCode: string | null = null;
  let cancelled = false;
  const server = _http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.end("State mismatch");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Missing authorization code");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      lastCode = code;
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });
  return new Promise((resolve) => {
    server
      .listen(1455, "127.0.0.1", () => {
        resolve({
          close: () => server.close(),
          cancelWait: () => {
            cancelled = true;
          },
          waitForCode: async () => {
            const sleep = () => new Promise((r) => setTimeout(r, 100));
            for (let i = 0; i < 600; i += 1) {
              if (lastCode) return { code: lastCode };
              if (cancelled) return null;
              await sleep();
            }
            return null;
          },
        });
      })
      .on("error", () => {
        resolve({
          close: () => {
            try {
              server.close();
            } catch {
              /* ignore */
            }
          },
          cancelWait: () => {},
          waitForCode: async () => null,
        });
      });
  });
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

export interface CodexLoginOptions {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (info: { message: string }) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  originator?: string;
}

/** Login with OpenAI Codex OAuth (faithful port of pi's `loginOpenAICodex`). */
export async function loginOpenAICodex(
  options: CodexLoginOptions,
): Promise<OAuthCredentials & { accountId: string }> {
  const { verifier, state, url } = await createAuthorizationFlow(options.originator);
  const server = await startLocalOAuthServer(state);
  options.onAuth({ url, instructions: "A browser window should open. Complete login to finish." });
  let code: string | undefined;
  try {
    if (options.onManualCodeInput) {
      let manualCode: string | undefined;
      let manualError: Error | undefined;
      const manualPromise = options
        .onManualCodeInput()
        .then((input) => {
          manualCode = input;
          server.cancelWait();
        })
        .catch((err) => {
          manualError = err instanceof Error ? err : new Error(String(err));
          server.cancelWait();
        });
      const result = await server.waitForCode();
      if (manualError) throw manualError;
      if (result?.code) code = result.code;
      else if (manualCode) {
        const parsed = parseAuthorizationInput(manualCode);
        if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
        code = parsed.code;
      }
      if (!code) {
        await manualPromise;
        if (manualError) throw manualError;
        if (manualCode) {
          const parsed = parseAuthorizationInput(manualCode);
          if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
          code = parsed.code;
        }
      }
    } else {
      const result = await server.waitForCode();
      if (result?.code) code = result.code;
    }
    if (!code) {
      const input = await options.onPrompt({
        message: "Paste the authorization code (or full redirect URL):",
      });
      const parsed = parseAuthorizationInput(input);
      if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
      code = parsed.code;
    }
    if (!code) throw new Error("Missing authorization code");
    const tokenResult = await exchangeAuthorizationCode(code, verifier);
    if (tokenResult.type !== "success") throw new Error("Token exchange failed");
    const accountId = getAccountId(tokenResult.access as string);
    if (!accountId) throw new Error("Failed to extract accountId from token");
    return {
      access: tokenResult.access as string,
      refresh: tokenResult.refresh as string,
      expires: tokenResult.expires as number,
      accountId,
    };
  } finally {
    server.close();
  }
}

/** Refresh OpenAI Codex OAuth token (faithful port of pi's `refreshOpenAICodexToken`). */
export async function refreshOpenAICodexToken(
  refreshToken: string,
): Promise<OAuthCredentials & { accountId: string }> {
  const result = await refreshAccessToken(refreshToken);
  if (result.type !== "success") throw new Error("Failed to refresh OpenAI Codex token");
  const accountId = getAccountId(result.access as string);
  if (!accountId) throw new Error("Failed to extract accountId from token");
  return {
    access: result.access as string,
    refresh: result.refresh as string,
    expires: result.expires as number,
    accountId,
  };
}
