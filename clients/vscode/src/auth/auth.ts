import * as vscode from "vscode";
import {
  completeDeviceSignIn,
  revokeKey,
  startDeviceSignIn,
  type DeviceAuthDeps,
  type DeviceCodeStart,
} from "@builderforce/device-auth";
import { getBaseUrl, getWebBaseUrl, SECRET_KEY } from "../gateway/gateway";
import { clearLocalProviderCredentials } from "./localProviderCredentials";
import { getScopedToken, invalidateScopedTokens, setScopedTokenErrorSink, type ScopedAudience } from "../bfApi/scopedToken";
import { logLine } from "../diagnostics/errorReporter";
import { messageOf } from "../shared/messageOf";
import { sleep } from "../shared/sleep";
import { BUILDERFORCE_AUTH_PROVIDER_ID } from "./providerId";

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
    sleep,
    now: () => Date.now(),
    client: "vscode",
  };
}

export { BUILDERFORCE_AUTH_PROVIDER_ID };
const PROVIDER_ID = BUILDERFORCE_AUTH_PROVIDER_ID;
const PROVIDER_LABEL = "BuilderForce";

function isScopedAudience(scope: string): scope is ScopedAudience {
  return scope === "spawn";
}

export { getWebBaseUrl as appUrl } from "../gateway/gateway";

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
    setScopedTokenErrorSink((e) => logLine(`Scoped token mint failed: ${messageOf(e)}`));
    ctx.subscriptions.push(
      vscode.authentication.registerAuthenticationProvider(PROVIDER_ID, PROVIDER_LABEL, provider, {
        supportsMultipleAccounts: false,
      }),
    );
    return provider;
  }

  /**
   * Sessions are scope-aware (SEC-G017). `spawn` yields a short-lived audience-scoped
   * token (never the tenant JWT or the editor key); every other scope yields an opaque
   * marker session with an EMPTY `accessToken` — the raw editor key stays in SecretStorage
   * and no caller of this provider can read it.
   */
  async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    if (!key) return [];
    return this.sessionFor(scopes);
  }

  async createSession(scopes?: readonly string[]): Promise<vscode.AuthenticationSession> {
    // A request for a NEW session never serves a cached token: the caller is asking because the old one was rejected.
    invalidateScopedTokens();
    if (!(await this.ctx.secrets.get(SECRET_KEY))) {
      const key = await this.signIn();
      await this.ctx.secrets.store(SECRET_KEY, key);
      const added = this.markerSession();
      this._onDidChangeSessions.fire({ added: [added], removed: [], changed: [] });
    }
    const [session] = await this.sessionFor(scopes);
    if (!session) throw new Error(vscode.l10n.t("Could not get a BuilderForce session for the requested scope."));
    return session;
  }

  async removeSession(): Promise<void> {
    const key = await this.ctx.secrets.get(SECRET_KEY);
    await this.ctx.secrets.delete(SECRET_KEY);
    // Connected-subscription tokens belong to this workspace's account; the next sign-in
    // may be someone else's.
    await clearLocalProviderCredentials();
    if (key) {
      // Best-effort server-side revoke, so the key dies with the local session instead
      // of being left valid on the gateway. It never throws — a failed revoke must not
      // block local sign-out.
      await revokeKey(deviceAuthDeps(), key);
      this._onDidChangeSessions.fire({ added: [], removed: [this.markerSession()], changed: [] });
    }
  }

  /** The session for `scopes`: the scoped token for `spawn`, else the opaque marker. Signed in is the caller's check. */
  private async sessionFor(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const audience = scopes?.find(isScopedAudience);
    if (!audience) return [this.markerSession()];
    // An "unavailable" gateway (ScopedTokenUnavailableError) propagates as a throw: an empty
    // array would read as "signed out" to the caller, which is a different state.
    const token = await getScopedToken(this.ctx.secrets, audience);
    return token ? [this.markerSession(token, [audience], `${PROVIDER_ID}:${audience}`)] : [];
  }

  private markerSession(accessToken = "", scopes: string[] = ["gateway"], id = PROVIDER_ID): vscode.AuthenticationSession {
    return { id, accessToken, account: { id: PROVIDER_ID, label: PROVIDER_LABEL }, scopes };
  }

  private async signIn(): Promise<string> {
    const viaDevice = await this.tryDeviceCode().catch(() => undefined);
    if (viaDevice) return viaDevice;
    return this.pasteKey();
  }

  private async pasteKey(): Promise<string> {
    // Land the user on the "Connect your editor" page: it signs them in (or prompts
    // login), generates an editor key, and shows it with a Copy button. They paste here.
    await vscode.env.openExternal(vscode.Uri.parse(`${getWebBaseUrl()}/activate`));
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
