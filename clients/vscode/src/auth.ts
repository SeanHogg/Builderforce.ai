import * as vscode from "vscode";
import {
  completeDeviceSignIn,
  revokeKey,
  startDeviceSignIn,
  type DeviceAuthDeps,
  type DeviceCodeStart,
} from "@builderforce/device-auth";
import { getBaseUrl, SECRET_KEY } from "./gateway";

/**
 * The editor's side of the shared device sign-in (`@builderforce/device-auth`, the same
 * flow Rovr runs): the gateway it talks to, the browser it opens, and the clock.
 */
function deviceAuthDeps(): DeviceAuthDeps {
  return {
    baseUrl: getBaseUrl(),
    fetch: (input, init) => fetch(input, init),
    openTab: async (url) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    client: "vscode",
  };
}

const PROVIDER_ID = "builderforce";
const PROVIDER_LABEL = "BuilderForce";

/** The web app URL, derived from the gateway base (api.builderforce.ai → builderforce.ai). */
export function appUrl(): string {
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
      // Best-effort server-side revoke, so the key dies with the local session instead
      // of being left valid on the gateway. It never throws — a failed revoke must not
      // block local sign-out.
      await revokeKey(deviceAuthDeps(), key);
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
    // Land the user on the "Connect your editor" page: it signs them in (or prompts
    // login), generates an editor key, and shows it with a Copy button. They paste here.
    await vscode.env.openExternal(vscode.Uri.parse(`${appUrl()}/activate`));
    const key = await vscode.window.showInputBox({
      title: "Sign in to BuilderForce",
      prompt: "A browser opened with your editor key — copy it there and paste it here.",
      placeHolder: "Paste your editor key…",
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
    const deps = deviceAuthDeps();
    let start: DeviceCodeStart;
    try {
      start = await startDeviceSignIn(deps);
    } catch {
      return undefined; // endpoint absent/unhealthy → fall back
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `BuilderForce: approve in your browser (code ${start.userCode})…`,
      },
      async (_progress, token) => {
        const abort = new AbortController();
        const cancelled = token.onCancellationRequested(() => abort.abort());
        try {
          return (await completeDeviceSignIn(deps, start, abort.signal)).accessKey;
        } finally {
          cancelled.dispose();
        }
      },
    );
  }
}
