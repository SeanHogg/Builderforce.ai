/**
 * The HTML shell that boots the bundled-React webview (`media/webview/index.js`).
 *
 * Pure — no `vscode` import — so the extension-host integration suite renders the
 * SAME shell, under the SAME CSP, that the panels ship. It used to keep a hand copy,
 * and the copy fell behind: when the bundle became code-split the real shell granted
 * chunks by origin while the copy still allowed only the nonce'd entry, so the gate
 * could fail on a CSP the panels never use (or pass on one they no longer use).
 */

/** A random nonce for a webview CSP (`script-src`, and inline `<style>` on the board). */
export function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export interface BundleShellInput {
  /** `webview.cspSource` — the origin the extension's own files are served from. */
  cspSource: string;
  nonce: string;
  /** The gateway/API origin the app fetches directly. */
  apiOrigin: string;
  /** `asWebviewUri` for a file in `media/webview`, already stringified. */
  assetUrl: (file: "index.js" | "index.css") => string;
  title: string;
  /** Inline script run before the bundle (nonce'd here). The integration suite uses it to report boot errors. */
  preludeScript?: string;
}

/** The bundle's Content-Security-Policy. */
export function bundleCsp({ cspSource, nonce, apiOrigin }: Pick<BundleShellInput, "cspSource" | "nonce" | "apiOrigin">): string {
  // A nonce authorises the ENTRY script only — it does not extend to modules that
  // script imports. The bundle is code-split (the board's own dependencies, the
  // Evermind engines, the voice studio and mermaid load on demand), so its chunks
  // must be allowed by origin or every lazy feature dies at the import.
  const scriptSrc = `'nonce-${nonce}' ${cspSource} 'wasm-unsafe-eval'`;
  return [
    `default-src 'none'`,
    `img-src ${cspSource} https: data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${scriptSrc}`,
    `font-src ${cspSource} data:`,
    `connect-src ${apiOrigin} https: blob: data:`,
    // The canvas renders generated artefacts: website/mockup previews in frames,
    // audio + video deliverables, and WebGPU/WASM training in a worker. Always
    // granted now that every panel can be the board.
    //
    // `https:` carries the canvas Web page panel, which frames an arbitrary address
    // the user typed or dropped; the allowlist alternative cannot express "any
    // page". Frames are sandboxed and cross-origin. The loopback origins are what
    // make a `service` object — the dev server running in this very editor —
    // previewable, which the deployed web app cannot do at all (a https page may
    // not frame http).
    `frame-src ${cspSource} https: http://localhost:* http://127.0.0.1:* blob: data:`,
    `media-src ${cspSource} https: blob: data:`,
    `worker-src ${cspSource} blob:`,
  ].join("; ");
}

export function renderBundleShell(input: BundleShellInput): string {
  const { nonce, assetUrl, title, preludeScript } = input;
  const prelude = preludeScript ? `\n<script nonce="${nonce}">${preludeScript}</script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${bundleCsp(input)}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${assetUrl("index.css")}" />
<title>${title}</title>${prelude}
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${assetUrl("index.js")}"></script>
</body>
</html>`;
}
