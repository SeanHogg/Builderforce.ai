import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { nativeAddonPath } from "./nativeEngine";

/** The universal VSIX ships every platform's addon; a host must only ever resolve its own. */
describe("nativeAddonPath", () => {
  const out = path.join("/ext", "out");
  const shipped = (...names: string[]) => (file: string) => names.some((n) => file === path.join(out, n));

  it("resolves the tagged addon for this platform", () => {
    const exists = shipped("bfi_node.win32-x64.node", "bfi_node.linux-x64.node");
    expect(nativeAddonPath(out, exists, "win32", "x64")).toBe(path.join(out, "bfi_node.win32-x64.node"));
    expect(nativeAddonPath(out, exists, "linux", "x64")).toBe(path.join(out, "bfi_node.linux-x64.node"));
  });

  it("never returns another platform's addon", () => {
    const exists = shipped("bfi_node.linux-x64.node", "bfi_node.darwin-arm64.node");
    expect(nativeAddonPath(out, exists, "win32", "x64")).toBeUndefined();
  });

  it("never returns the untagged legacy name", () => {
    expect(nativeAddonPath(out, shipped("bfi_node.node"), "win32", "x64")).toBeUndefined();
  });
});
