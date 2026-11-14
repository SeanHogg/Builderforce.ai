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
export function makeNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < 32; i++)
        out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
/** The `id` of the `<script type="application/json">` block that carries {@link RootFallbackStrings}. */
export const BOOT_STRINGS_ELEMENT_ID = "bf-boot-strings";
/**
 * JSON for an inline `<script>` data block. Every `<` is escaped, so no string can
 * close the element (`</script>`) or open a comment (`<!--`). A data block is never
 * parsed as script, so nothing else needs escaping, and the result is still valid
 * JSON: the escape sequence parses back to `<`.
 */
export function inlineJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}
/**
 * The same document with a NEW nonce — what "Reload panel" assigns back to
 * `webview.html`. VS Code ignores an assignment of an identical string, so a reload
 * needs a different document; swapping the nonce (CSP and every script tag together)
 * gives one that is otherwise byte-for-byte what the panel booted with. A shell with
 * no nonce gets a reload marker instead.
 */
export function withFreshNonce(html, nonce = makeNonce()) {
    const current = /'nonce-([A-Za-z0-9+/=]+)'/.exec(html)?.[1];
    if (current)
        return html.split(current).join(nonce);
    return `${html.replace(/<!-- bf-reload [A-Za-z0-9]+ -->$/, "")}<!-- bf-reload ${nonce} -->`;
}
/** Escape a value for a double-quoted HTML attribute. */
function escapeAttr(value) {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** The bundle's Content-Security-Policy. */
export function bundleCsp({ cspSource, nonce, apiOrigin }) {
    // A nonce authorises the ENTRY script only — it does not extend to modules that
    // script imports. The bundle is code-split (the board's own dependencies, the
    // Evermind engines, the voice studio and mermaid load on demand), so its chunks
    // must be allowed by origin or every lazy feature dies at the import.
    // `'wasm-unsafe-eval'` is also what lets the page engines (PRD 34) compile WebLLM's and
    // `bfi`'s WebAssembly here; their model downloads (huggingface.co, *.hf.co,
    // raw.githubusercontent.com) ride the `https:` grant in `connect-src` below.
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
export function renderBundleShell(input) {
    const { nonce, assetUrl, title, preludeScript, bootLabel, bootStrings } = input;
    const prelude = preludeScript ? `\n<script nonce="${nonce}">${preludeScript}</script>` : "";
    const bootAttr = bootLabel ? ` data-boot-label="${escapeAttr(bootLabel)}"` : "";
    // A data block never executes, so the CSP does not gate it; the nonce is carried anyway.
    const strings = bootStrings
        ? `\n<script type="application/json" id="${BOOT_STRINGS_ELEMENT_ID}" nonce="${nonce}">${inlineJson(bootStrings)}</script>`
        : "";
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
<div id="root"${bootAttr}></div>${strings}
<script type="module" nonce="${nonce}" src="${assetUrl("index.js")}"></script>
</body>
</html>`;
}
//# sourceMappingURL=webviewBundleShell.js.map