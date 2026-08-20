/**
 * Extension-host integration tests — the layer the offline `harness/` cannot reach.
 *
 * `harness/` covers the chat run loop end to end without an editor, and the unit suite
 * covers the pure modules. Everything BETWEEN them was validated only by building a
 * `.vsix`, installing it, reloading the window and clicking: activation, command
 * registration, the contributed views, and the webview↔host `postMessage` bridge. Those
 * are exactly the regressions that survive a green `pnpm test` and then break on the
 * first real launch — a command declared in `package.json` but never registered shows
 * up in the palette and throws "command not found"; a webview whose bundle or CSP is
 * wrong renders a blank panel with no error anywhere.
 *
 * These run inside a REAL VS Code, downloaded by `@vscode/test-electron`, so they need
 * network on first run and are therefore NOT part of `pnpm test`. Run them with
 * `pnpm test:integration`.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'builderforce.builderforce-ai';

/** The manifest as SHIPPED — the tests assert the running host against this, not
 *  against a hand-maintained list that would drift the moment a command is added. */
function manifest(): {
  contributes: {
    commands?: Array<{ command: string }>;
    menus?: Record<string, Array<{ command?: string }>>;
    views?: Record<string, Array<{ id: string }>>;
    viewsContainers?: { activitybar?: Array<{ id: string }> };
  };
} {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `extension ${EXTENSION_ID} is not installed in this host`);
  return ext.packageJSON;
}

suite('activation', () => {
  test('the extension activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} is not installed in this host`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true, 'activate() resolved but the extension is not active');
  });

  /**
   * `onStartupFinished` is the only activation event, so a throw inside `activate()`
   * leaves EVERY surface dead with nothing but a notification the user may have
   * dismissed. The signed-in context key is what the eight sidebar views gate on, so
   * an activation that half-ran is visible here as an unset key.
   */
  test('activation sets the sign-in context key the sidebar views gate on', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    // `getContextKeyValue` is not public API; the observable proxy is that the view
    // container resolves at all — an unset key would leave every view hidden.
    const containers = manifest().contributes.viewsContainers?.activitybar ?? [];
    assert.ok(containers.some((c) => c.id === 'builderforce'), 'the activity-bar container is not contributed');
  });
});

suite('command registration', () => {
  /**
   * THE classic activation regression: a command is added to `contributes.commands`
   * (so it appears in the palette) and the matching `registerCommand` is forgotten, or
   * moved behind a branch that no longer runs. The palette entry then throws
   * "command 'x' not found" at the user. Nothing below the extension host can catch
   * this — the manifest and the registration live in different files.
   */
  test('every declared command is actually registered', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const declared = (manifest().contributes.commands ?? []).map((c) => c.command);
    assert.ok(declared.length > 0, 'the manifest declares no commands — the test is asserting nothing');
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepStrictEqual(missing, [], `declared in package.json but never registered: ${missing.join(', ')}`);
  });

  /**
   * The other half of the same list. A command referenced from a menu contribution but
   * never DECLARED renders with no title and cannot be found in the palette — the usual
   * shape of a rename that updated one file. (The reverse superset is deliberately not
   * asserted: a command registered without being declared is a legitimate INTERNAL
   * command — `builderforce.openCreationSessionItem` is attached to a Sessions tree item,
   * `builderforce.refreshSessions` is executed from code — and declaring those would put
   * them in the palette, which is the opposite of what is wanted.)
   */
  test('every command referenced by a menu contribution is declared and registered', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const declared = new Set((manifest().contributes.commands ?? []).map((c) => c.command));
    const registered = new Set(await vscode.commands.getCommands(true));
    const menus = manifest().contributes.menus ?? {};
    const referenced = new Set(
      Object.values(menus).flat().map((m) => m.command).filter((id): id is string => typeof id === 'string'),
    );
    assert.ok(referenced.size > 0, 'no menu contributions reference a command — the test is asserting nothing');
    const broken = [...referenced].filter((id) => !declared.has(id) || !registered.has(id));
    assert.deepStrictEqual(broken, [], `menu entries pointing at a command that is not both declared and registered: ${broken.join(', ')}`);
  });
});

suite('contributed views', () => {
  /**
   * A view whose provider was never registered still contributes a focusable id, but
   * renders empty forever. Focusing each one exercises the provider resolution path
   * that only exists in a real host.
   */
  test('every contributed view can be focused', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const views = Object.values(manifest().contributes.views ?? {}).flat().map((v) => v.id);
    assert.ok(views.length > 0, 'the manifest contributes no views — the test is asserting nothing');
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const id of views) {
      assert.ok(registered.has(`${id}.focus`), `view "${id}" contributes no focus command — it was not registered`);
    }
  });
});

suite('webview ↔ host bridge', () => {
  /**
   * The shipped bundle must EXIST where the shell points. A missing/renamed asset is
   * the single most common cause of a blank panel, and `.vscodeignore` + the vite
   * output directory are configured in two different files.
   */
  test('the webview bundle the shell loads is present in the extension', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    for (const file of ['index.js', 'index.css']) {
      const p = path.join(ext.extensionPath, 'media', 'webview', file);
      assert.ok(fs.existsSync(p), `media/webview/${file} is missing — the panel would render blank`);
    }
  });

  /**
   * A REAL round-trip over the real bundle: mount the shipped webview script under the
   * same CSP the panels use, and wait for the app's own first message to reach the
   * host. If the bundle fails to parse, the CSP blocks the module, or the
   * `acquireVsCodeApi` handshake regresses, NOTHING arrives and this times out —
   * which is precisely the failure that used to require installing a `.vsix` to see.
   */
  test('the shipped webview boots and its first message reaches the host', async function () {
    // A cold webview + a large bundle: generous, and still far quicker than a package
    // + install + reload cycle.
    this.timeout(30_000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const panel = vscode.window.createWebviewPanel(
      'builderforce.bridgeTest',
      'BuilderForce bridge test',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(ext.extensionUri, 'media')] },
    );
    try {
      const received = new Promise<{ type?: string; id?: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the webview sent nothing to the host within the timeout')), 25_000);
        panel.webview.onDidReceiveMessage((msg) => {
          clearTimeout(timer);
          resolve(msg as { type?: string; id?: string });
        });
      });
      panel.webview.html = bridgeHtml(panel.webview, ext.extensionUri);
      const first = await received;
      assert.ok(first && typeof first === 'object', 'the webview posted a non-object message');
      assert.ok(typeof first.type === 'string' && first.type.length > 0, `the first message carries no type: ${JSON.stringify(first)}`);
    } finally {
      panel.dispose();
    }
  });
});

/**
 * The panel shell, matching `renderWebviewHtml`'s contract for the `webview` bundle:
 * `default-src 'none'`, a nonce'd module script, and the extension's own asset origin
 * for styles and images. Written out here rather than imported because the extension
 * ships as ONE esbuild bundle — the test process cannot reach into it — and because a
 * shell the test builds itself is what makes a CSP regression in the real shell
 * detectable rather than mirrored.
 */
function bridgeHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = Array.from({ length: 32 }, () => Math.random().toString(36)[2] ?? 'a').join('');
  const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', f));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`,
    `connect-src https: blob: data:`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${asset('index.css')}" />
<title>bridge</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${asset('index.js')}"></script>
</body>
</html>`;
}
