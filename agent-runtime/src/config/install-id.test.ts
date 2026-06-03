import { beforeEach, describe, expect, it } from "vitest";
import { getInstallId, resetInstallIdCache } from "./install-id.js";

describe("getInstallId", () => {
  beforeEach(() => {
    resetInstallIdCache();
  });

  it("returns 8-char hex string when package root is found", () => {
    // This test runs from product repo; package.json with name "builderforce" is at product root
    const selfUrl = import.meta.url;
    const id = getInstallId(selfUrl);
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[a-f0-9]{8}$/);
  });

  it("returns same id on second call (cached)", () => {
    const selfUrl = import.meta.url;
    const a = getInstallId(selfUrl);
    const b = getInstallId(selfUrl);
    expect(a).toBe(b);
  });

  it("returns null for URL that does not resolve to builderforce package", () => {
    const fakeUrl = new URL("file:///tmp/other/package/dist/config/paths.js").href;
    const id = getInstallId(fakeUrl);
    expect(id).toBeNull();
  });
});
