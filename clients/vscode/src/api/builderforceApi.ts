import * as vscode from "vscode";
import type { BuilderforceApi } from "./builderforceApiTypes";
import { BUILDERFORCE_AUTH_PROVIDER_ID } from "../auth/providerId";
import { invalidateScopedTokens } from "../bfApi/scopedToken";

export type { BuilderforceApi } from "./builderforceApiTypes";

/** The existing seams the API is built from; the extension passes the real ones. */
export interface BuilderforceApiDeps {
  /** `getBaseUrl()` from `gateway/gateway.ts`. */
  getBaseUrl(): string;
  /** `getWebBaseUrl()` from `gateway/gateway.ts`. */
  getWebUrl(): string;
  /** Whether a gateway key is stored right now (what the auth provider's `getSessions` reads). */
  isSignedIn(): Promise<boolean>;
  /** `vscode.authentication.onDidChangeSessions`; the API filters to the builderforce provider. */
  onDidChangeSessions: vscode.Event<{ provider: { id: string } }>;
}

/** Builds the API object `activate()` returns. Holds no session state of its own and exports no credential. */
export function createBuilderforceApi(deps: BuilderforceApiDeps): BuilderforceApi & vscode.Disposable {
  const signInChanged = new vscode.EventEmitter<boolean>();
  const subscription = deps.onDidChangeSessions((e) => {
    if (e.provider.id !== BUILDERFORCE_AUTH_PROVIDER_ID) return;
    void deps.isSignedIn().then((signedIn) => signInChanged.fire(signedIn), () => signInChanged.fire(false));
  });
  return {
    version: 2,
    getBaseUrl: () => deps.getBaseUrl(),
    getWebUrl: () => deps.getWebUrl(),
    onDidChangeSignIn: signInChanged.event,
    invalidateScopedToken: () => invalidateScopedTokens(),
    dispose: () => {
      subscription.dispose();
      signInChanged.dispose();
    },
  };
}
