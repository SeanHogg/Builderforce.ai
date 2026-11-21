import type * as vscode from "vscode";

/**
 * Open the launcher's URL in the browser, handed over as the STRING it is.
 *
 * `Uri.parse(url).toString()` re-encodes the fragment (`#token=…` → `#token%3D…`) and the
 * launcher page would find no token. The extension host's `openUri` accepts a string and
 * opens it verbatim, so the string is passed through the `Uri`-typed API unchanged.
 */
export function openUrlVerbatim(openExternal: (target: vscode.Uri) => Thenable<boolean>): (url: string) => Promise<void> {
  return async (url) => {
    await openExternal(url as unknown as vscode.Uri);
  };
}

/**
 * VS Code's NATIVE integrated browser ("Open Integrated Browser"): a real Chromium view in an
 * editor tab, so the launcher's service worker and HTTPS run as in a browser. Its action takes
 * a URL string (or `{ url, openToSide?, reuseUrlFilter? }`). Not the Simple Browser
 * (`simpleBrowser.show`): that is an iframe in a webview, and the launcher page refuses to be
 * framed (`frame-ancestors 'none'`). Shipped in newer VS Code than `engines.vscode` requires,
 * so it is detected at runtime.
 */
export const INTEGRATED_BROWSER_OPEN = "workbench.action.browser.open";

/** What the integrated-browser opener needs from `vscode.commands`. */
export interface EditorCommands {
  getCommands(filterInternal: boolean): Thenable<string[]>;
  executeCommand(command: string, url: string): Thenable<unknown>;
}

/** The integrated browser, when this VS Code has one: detected once per session, opened with the URL STRING (its `#token` intact). */
export interface EditorBrowser {
  available(): Promise<boolean>;
  open(url: string): Promise<void>;
}

/** A detection that cannot run is reported and answers "not available" — the launch falls back to the system browser. */
export function integratedBrowser(commands: EditorCommands, report: (error: unknown) => void): EditorBrowser {
  let detected: Promise<boolean> | undefined;
  return {
    available: () => (detected ??= Promise.resolve(commands.getCommands(true)).then(
      (ids) => ids.includes(INTEGRATED_BROWSER_OPEN),
      (error: unknown) => { report(error); return false; },
    )),
    open: async (url) => {
      await commands.executeCommand(INTEGRATED_BROWSER_OPEN, url);
    },
  };
}
