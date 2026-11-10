import { describe, expect, it } from "vitest";
import { BOOT_STRINGS_ELEMENT_ID, inlineJson, renderBundleShell, withFreshNonce, type RootFallbackStrings } from "./webviewBundleShell";

const NONCE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

function shell(bootStrings?: RootFallbackStrings): string {
  return renderBundleShell({
    cspSource: "vscode-resource:",
    nonce: NONCE,
    apiOrigin: "https://api.example",
    assetUrl: (file) => `vscode-resource:/media/webview/${file}`,
    title: "BuilderForce",
    bootStrings,
  });
}

/** The text inside the boot-strings data block, or undefined when there is none. */
function bootBlock(html: string): string | undefined {
  const match = new RegExp(`<script type="application/json" id="${BOOT_STRINGS_ELEMENT_ID}" nonce="${NONCE}">([\\s\\S]*?)</script>`).exec(html);
  return match?.[1];
}

describe("the bundle shell's boot strings", () => {
  // Hostile on purpose: a translation that contains `</script>` or `<!--` must not end the block.
  const strings: RootFallbackStrings = {
    title: "Fehler </script><script>alert(1)</script>",
    body: "<!-- not a comment --> & \"quoted\"",
    reload: "Panel neu laden",
    copy: "复制详细信息",
  };

  it("embeds the localized fallback copy as valid, escaped JSON", () => {
    const html = shell(strings);
    const block = bootBlock(html);
    expect(block).toBeDefined();
    expect(block).not.toContain("<");
    expect(JSON.parse(block!)).toEqual(strings);
    // The only `</script>` closers are the shell's own: the block's, and the bundle's.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("puts the block after the root element and before the bundle", () => {
    const html = shell(strings);
    expect(html.indexOf('<div id="root"')).toBeLessThan(html.indexOf(BOOT_STRINGS_ELEMENT_ID));
    expect(html.indexOf(BOOT_STRINGS_ELEMENT_ID)).toBeLessThan(html.indexOf('type="module"'));
  });

  it("omits the block when no strings are given", () => {
    expect(shell()).not.toContain(BOOT_STRINGS_ELEMENT_ID);
  });

  it("inlineJson round-trips through JSON.parse", () => {
    const value = { a: "</script>", b: "<!--", c: [1, "<"] };
    expect(inlineJson(value)).not.toContain("<");
    expect(JSON.parse(inlineJson(value))).toEqual(value);
  });
});

describe("withFreshNonce (Reload panel)", () => {
  it("swaps the nonce everywhere, so the document differs and still boots under its CSP", () => {
    const html = shell({ title: "t", body: "b", reload: "r", copy: "c" });
    const next = withFreshNonce(html, "ZyXwVuTsRqPoNmLkJiHgFeDcBa543210");
    expect(next).not.toBe(html);
    expect(next).not.toContain(NONCE);
    expect(next).toContain("'nonce-ZyXwVuTsRqPoNmLkJiHgFeDcBa543210'");
    expect(next.match(/nonce="ZyXwVuTsRqPoNmLkJiHgFeDcBa543210"/g)).toHaveLength(2);
    expect(next.replaceAll("ZyXwVuTsRqPoNmLkJiHgFeDcBa543210", NONCE)).toBe(html);
  });

  it("still yields a different document for a shell without a nonce", () => {
    const html = "<html><body>static</body></html>";
    const once = withFreshNonce(html, "one");
    const twice = withFreshNonce(once, "two");
    expect(once).not.toBe(html);
    expect(twice).not.toBe(once);
    expect(twice).toBe(`${html}<!-- bf-reload two -->`);
  });
});
