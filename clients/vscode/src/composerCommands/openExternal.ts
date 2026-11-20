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
