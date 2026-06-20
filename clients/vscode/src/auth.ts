import * as vscode from "vscode";
import { getBaseUrl, SECRET_KEY } from "./gateway";

const PROVIDER_ID = "builderforce";
const PROVIDER_LABEL = "BuilderForce";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The web app URL, derived from the gateway base (api.builderforce.ai → builderforce.ai). */
function appUrl(): string {
  try {
    const u = new URL(getBaseUrl());
    u.hostname = u.hostname.replace(/^api\./, "");
    u.pathname = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "https://builderforce.ai";
  }
}

/**
 * Auth provider for BuilderForce. `createSession` runs the browser device-code flow
 * (RFC 8628) against `/api/auth/device/*`; if those endpoints are unavailable (not yet
 * deployed) it falls back to a paste-key prompt. Either way the resulting gateway key
 * is stored in the OS keychain via SecretStorage, so the rest of the extension reads it
 * from one place (SECRET_KEY).
 */
export class BuilderForceAuthProvider implements vscode.AuthenticationProvider {
  static readonly id = PROVIDER_ID;

  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  static register(ctx: vscode.ExtensionContext): BuilderForceAuthProvider {
    const provider = new BuilderForceAuthProvider(ctx);
    ctx.subscriptions.push(
      vscode.authentication.registerAuthenticationProvider(PROVIDER_ID, PROVIDER_LABEL, provider, {
        supportsMultipleAccounts: false,
      }),
    );
    return provider;
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    return key ? [this.toSession(key)] : [];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const key = await this.signIn();
    await this.ctx.secrets.store(SECRET_KEY, key);
    const session = this.toSession(key);
    this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    await this.ctx.secrets.delete(SECRET_KEY);
    if (key) {
      this._onDidChangeSessions.fire({ added: [], removed: [this.toSession(key)], changed: [] });
    }
  }

  private toSession(key: string): vscode.AuthenticationSession {
    return {
      id: PROVIDER_ID,
      accessToken: key,
      account: { id: PROVIDER_ID, label: PROVIDER_LABEL },
      scopes: ["gateway"],
    };
  }

  private async signIn(): Promise<string> {
    const viaDevice = await this.tryDeviceCode().catch(() => undefined);
    if (viaDevice) return viaDevice;
    return this.pasteKey();
  }

  private async pasteKey(): Promise<string> {
    // Land the user on the API-keys page: it authenticates them (or prompts login),
    // then lets them create a key and copy it with one click. They paste it back here.
    await vscode.env.openExternal(vscode.Uri.parse(`${appUrl()}/settings/api-keys`));
    const key = await vscode.window.showInputBox({
      title: "Sign in to BuilderForce",
      prompt: "In the browser, create an API key and copy it — then paste it here.",
      placeHolder: "Paste your API key…",
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) throw new Error("Sign-in cancelled");
    return key.trim();
  }

  /**
   * Returns a gateway key via the device flow, or undefined if the endpoints are not
   * available (so the caller falls back to paste-key). Throws only on explicit
   * cancellation / denial / timeout after the flow has genuinely started.
   */
  private async tryDeviceCode(): Promise<string | undefined> {
    const base = getBaseUrl();

    let start: {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      interval?: number;
      expires_in?: number;
    };
    try {
      const res = await fetch(`${base}/api/auth/device/code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: "vscode" }),
      });
      if (!res.ok) return undefined; // endpoint absent/unhealthy → fall back
      start = (await res.json()) as typeof start;
    } catch {
      return undefined;
    }

    const { device_code, user_code, verification_uri, verification_uri_complete } = start;
    if (!device_code || !verification_uri) return undefined;

    const openUrl = verification_uri_complete || verification_uri;
    await vscode.env.openExternal(vscode.Uri.parse(openUrl));

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `BuilderForce: approve in your browser${user_code ? ` (code ${user_code})` : ""}…`,
      },
      async (_progress, token) => {
        const deadline = Date.now() + (start.expires_in ?? 600) * 1000;
        let delay = Math.max(start.interval ?? 5, 1) * 1000;
        while (Date.now() < deadline) {
          if (token.isCancellationRequested) throw new Error("Sign-in cancelled");
          await sleep(delay);
          const r = await fetch(`${base}/api/auth/device/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ device_code }),
          });
          if (r.status === 200) {
            const body = (await r.json()) as { access_key?: string };
            if (body.access_key) return body.access_key;
            throw new Error("Device token response missing access_key");
          }
          if (r.status === 428) continue; // authorization_pending
          if (r.status === 429) {
            delay += 2000; // slow_down
            continue;
          }
          if (r.status === 403) throw new Error("Sign-in was denied");
          throw new Error(`Device sign-in failed (${r.status})`);
        }
        throw new Error("Device sign-in timed out");
      },
    );
  }
}
