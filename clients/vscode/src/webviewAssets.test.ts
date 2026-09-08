import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * THE SHELL LOADS ONE STYLESHEET, SO THE BUILD MUST EMIT ONE.
 *
 * ── THE BUG THIS EXISTS FOR ──────────────────────────────────────────────────
 * `renderWebviewHtml` writes a single `<link rel="stylesheet" href="…/index.css">`.
 * When the chat and canvas bundles merged, the surviving Vite config had CSS code
 * splitting ON, so every async chunk carrying CSS emitted its own file and Vite
 * de-duplicated the names by counting: `index.css`, `index2.css` … `index6.css`.
 *
 * The shell still loaded only the first. The chat surface's entire stylesheet landed
 * in `index6.css` and was never applied — an unstyled textarea, a composer whose
 * buttons stacked vertically, a jammed header. It SHIPPED, because every check that
 * ran was blind to it: `tsc` type-checks, `vitest` runs units, and the extension-host
 * integration test proves the webview boots and posts a message. None of them look at
 * a pixel, and a stylesheet that is never fetched breaks none of them.
 *
 * So the invariant is asserted against the BUILT ARTIFACT, which is the only place it
 * is observable without rendering: one sheet, and it must actually carry the chat's
 * root class. Both halves matter — a single sheet containing the wrong styles would
 * fail exactly the same way.
 */

const mediaDir = path.join(__dirname, "..", "media", "webview");

/** The build is a prerequisite, not part of this test — `pnpm compile` produces it.
 *  Skipped rather than failed when absent so a bare `vitest` run is still useful. */
const built = fs.existsSync(mediaDir);

describe.skipIf(!built)("the built webview bundle", () => {
  const files = built ? fs.readdirSync(mediaDir) : [];

  it("emits exactly one stylesheet, because the shell loads exactly one", () => {
    const stylesheets = files.filter((file) => file.endsWith(".css"));

    expect(stylesheets).toEqual(["index.css"]);
  });

  it("puts the chat surface's own styles in the sheet that is actually loaded", () => {
    const css = fs.readFileSync(path.join(mediaDir, "index.css"), "utf8");

    // `.bf-app` is the chat surface's root and `.bf-header` its top row: if these are
    // missing, the conversation renders as unstyled markup even though every other
    // check passes.
    expect(css).toContain(".bf-app");
    expect(css).toContain(".bf-header");
    // The wrapper that positions the conversation when it is mounted as a surface OF
    // the canvas. Without it the transcript renders behind the board.
    expect(css).toContain(".bf-canvas-chat-surface");
  });

  it("ships the entry script the shell names", () => {
    expect(files).toContain("index.js");
  });
});
