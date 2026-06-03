/**
 * Localhost callback server for browser-based Builderforce authentication.
 *
 * Flow:
 *   1. CLI starts an HTTP server on 127.0.0.1:<CALLBACK_PORT>
 *   2. CLI opens the user's browser to the Builderforce CLI auth page
 *   3. User logs in / registers in the browser
 *   4. Browser redirects to localhost callback with token + state
 *   5. CLI validates state, extracts webToken, and shuts down the server
 *
 * Headless / SSH fallback: When no browser is available the user is shown a
 * URL to open manually and pastes the callback URL back into the terminal.
 */

import { randomBytes } from "node:crypto";
import http from "node:http";
import type { WizardPrompter } from "../wizard/prompts.js";
import { openUrl, detectBrowserOpenSupport } from "./onboard-helpers.js";

const CALLBACK_PORT = 51_122;
const TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BuilderForceAgents — Authenticated</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #0d1117; color: #c9d1d9; }
    .card { text-align: center; padding: 2rem; border-radius: 12px;
            background: #161b22; border: 1px solid #30363d; max-width: 420px; }
    h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
    p  { color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>&#x2705; Authentication complete</h1>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

export interface BrowserAuthResult {
  webToken: string;
}

/**
 * Authenticate with Builderforce via the user's browser.
 *
 * @returns The `webToken` (WebJWT) on success, or `null` if the user cancels.
 */
export async function authenticateViaBrowser(opts: {
  serverUrl: string;
  prompter: WizardPrompter;
}): Promise<BrowserAuthResult | null> {
  const state = randomBytes(16).toString("hex");
  const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;

  // Derive the app URL from the API URL (Builderforce.ai).
  const appUrl = opts.serverUrl
    .replace("api.builderforce.ai", "builderforce.ai")
    .replace("api.builderforce.ai", "builderforce.ai");
  const authUrl =
    `${appUrl}/auth/cli` +
    `?callback=${encodeURIComponent(callbackUrl)}` +
    `&state=${encodeURIComponent(state)}`;

  const browserSupport = await detectBrowserOpenSupport();

  if (browserSupport.ok) {
    return authenticateWithCallbackServer({ state, authUrl, prompter: opts.prompter });
  }

  // ── Headless / SSH fallback ────────────────────────────────────────────
  return authenticateManually({ state, authUrl, prompter: opts.prompter });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function authenticateWithCallbackServer(opts: {
  state: string;
  authUrl: string;
  prompter: WizardPrompter;
}): Promise<BrowserAuthResult | null> {
  const tokenPromise = startCallbackServer(opts.state);

  await opts.prompter.note(
    `Opening browser for authentication…\n${opts.authUrl}`,
    "Builderforce Auth",
  );

  const opened = await openUrl(opts.authUrl);

  if (!opened) {
    // Browser failed to open — fall back to manual flow.
    return authenticateManually({
      state: opts.state,
      authUrl: opts.authUrl,
      prompter: opts.prompter,
    });
  }

  try {
    return await tokenPromise;
  } catch {
    await opts.prompter.note("Authentication timed out or was cancelled.", "Auth Error");
    return null;
  }
}

async function authenticateManually(opts: {
  state: string;
  authUrl: string;
  prompter: WizardPrompter;
}): Promise<BrowserAuthResult | null> {
  await opts.prompter.note(
    [
      "Open this URL in a browser to authenticate:",
      "",
      opts.authUrl,
      "",
      "After authenticating, paste the full callback URL shown in the browser.",
    ].join("\n"),
    "Builderforce Auth (manual)",
  );

  const pastedUrl = await opts.prompter.text({
    message: "Paste the callback URL:",
    validate: (val: string) => {
      if (!val.includes("token=")) {
        return "Invalid callback URL — must contain a token parameter";
      }
      return undefined;
    },
  });
  if (typeof pastedUrl === "symbol" || !pastedUrl?.trim()) {
    return null;
  }

  const url = new URL(pastedUrl.trim());
  const token = url.searchParams.get("token");
  const returnedState = url.searchParams.get("state");

  if (returnedState !== opts.state) {
    throw new Error("State mismatch — authentication may have been tampered with.");
  }
  if (!token) {
    throw new Error("No token found in callback URL.");
  }

  return { webToken: token };
}

function startCallbackServer(expectedState: string): Promise<BrowserAuthResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const token = url.searchParams.get("token");
      const state = url.searchParams.get("state");

      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("State mismatch");
        return;
      }

      if (!token) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing token");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(SUCCESS_HTML);

      setImmediate(() => server.close());
      resolve({ webToken: token });
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 5 minutes."));
    }, TIMEOUT_MS);

    server.on("close", () => clearTimeout(timer));
  });
}
