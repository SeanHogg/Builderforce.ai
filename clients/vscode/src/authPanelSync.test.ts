import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Auth-gated webviews (Evermind sidebar + Brain/panel base) must agree with the
 * host's signed-in state after login. These source guards lock the wiring that
 * made Evermind show "Sign in to BuilderForce to start." while the host toasted
 * "BuilderForce: signed in."
 */
const src = (...parts: string[]) => readFileSync(join(__dirname, ...parts), "utf8");

describe("post-login auth surface sync", () => {
  const extension = src("extension.ts");
  const evermind = src("evermindView.ts");
  const shared = src("webviewShared.ts");
  const app = src("..", "webview", "src", "WorkspaceApp.tsx");

  it("awaits the signed-in context flip before refreshing Evermind", () => {
    // A fire-and-forget sync left `when: builderforce.signedIn` false while
    // `evermindView?.refresh()` ran — a no-op on an unresolved view.
    expect(extension).toMatch(/await syncSignedInContext\(context\);\s*\n\s*bfApi\.clearJwt\(\)/);
    expect(extension).toContain("refreshAuthBoundSurfaces()");
    expect(extension).toContain("evermindView?.refresh()");
  });

  it("re-pushes webview init when auth sessions change out-of-band", () => {
    expect(extension).toMatch(/onDidChangeSessions[\s\S]*refreshAuthBoundSurfaces\(\)/);
  });

  it("registers the Evermind message listener before setting html", () => {
    const resolve = evermind.slice(
      evermind.indexOf("resolveWebviewView"),
      evermind.indexOf("refresh():"),
    );
    expect(resolve.indexOf("onDidReceiveMessage")).toBeGreaterThan(-1);
    expect(resolve.indexOf("onDidReceiveMessage")).toBeLessThan(resolve.indexOf("webview.html"));
  });

  it("pushes init from resolveWebviewView, not only from ready", () => {
    const resolve = evermind.slice(
      evermind.indexOf("resolveWebviewView"),
      evermind.indexOf("refresh():"),
    );
    expect(resolve).toMatch(/void this\.sendInit\(\)/);
  });

  it("registers panel message listeners before setting html", () => {
    const ctor = shared.slice(shared.indexOf("this.panel.iconPath"), shared.indexOf("onDidDispose"));
    expect(ctor.indexOf("onDidReceiveMessage")).toBeLessThan(ctor.indexOf("webview.html"));
  });

  it("shows the sign-in wall only when signedIn is false, not when the token is late", () => {
    // `!signedIn || !getToken()` conflated a missing JWT with logged-out and
    // contradicted the host toast.
    expect(app).not.toMatch(/\(!init\.signedIn\s*\|\|\s*!getToken\(\)\)/);
    expect(app).toMatch(/if\s*\(!init\.signedIn\s*&&\s*!init\.localRoute\)/);
    expect(app).toMatch(/init\.signedIn\s*&&\s*!hasToken/);
    expect(app).toContain("void refreshToken()");
  });

  it("offers Retry instead of an endless Connecting… when the mint comes back empty", () => {
    expect(app).toContain("setTokenFailed(true)");
    expect(app).toContain("'app.retry'");
  });

  it("treats a refused editor key as signed out, not a dead signed-in session", () => {
    const api = src("bfApi.ts");
    const guard = src("editorKeyGuard.ts");
    // 401/400 is a verdict on the KEY and is announced; other failures are not.
    expect(api).toMatch(/res\.status === 401 \|\| res\.status === 400/);
    expect(api).toContain("editorKeyRejected.fire(key)");
    // The guard only expires the key that is STILL stored (a stale exchange must not
    // sign a fresh key out) and signs out through the normal path.
    expect(guard).toMatch(/secrets\.get\(SECRET_KEY\)\)\s*!==\s*rejectedKey/);
    expect(extension).toContain("watchRejectedEditorKey(context.secrets");
  });

  it("drops a refused key BEFORE getSession, so Sign in really opens the browser", () => {
    const signInFn = extension.slice(
      extension.indexOf("async function signIn("),
      extension.indexOf("async function autoSelectDefaultProject"),
    );
    expect(signInFn.indexOf("probeEditorKey")).toBeGreaterThan(-1);
    expect(signInFn.indexOf("probeEditorKey")).toBeLessThan(signInFn.indexOf("getSession"));
  });

  it("ships the shared auth labels to every auth-gated surface", () => {
    for (const file of ["builderforcePanel.ts", "evermindView.ts", "project360Panel.ts", "projectPagePanel.ts"]) {
      expect(src(file)).toContain("...authLabels()");
    }
  });
});
