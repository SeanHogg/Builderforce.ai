import { describe, expect, it } from "vitest";
import { isDesignArtefact, isDesignOnlyChangeSet } from "./designOnly";

describe("isDesignArtefact", () => {
  it("accepts a file under the top-level .design/ directory", () => {
    expect(isDesignArtefact(".design/hero.dc.html")).toBe(true);
    expect(isDesignArtefact(".design/nested/card.html")).toBe(true);
  });

  it("accepts a *.dc.html file anywhere (design-canonical HTML)", () => {
    expect(isDesignArtefact("mockups/hero.dc.html")).toBe(true);
    expect(isDesignArtefact("src/components/hero.dc.html")).toBe(true);
  });

  it("matches the .dc.html suffix case-insensitively", () => {
    expect(isDesignArtefact("mockups/hero.DC.HTML")).toBe(true);
    expect(isDesignArtefact("mockups/hero.Dc.Html")).toBe(true);
  });

  it("rejects ordinary source and design-adjacent files", () => {
    expect(isDesignArtefact("src/app.ts")).toBe(false);
    expect(isDesignArtefact("design/hero.html")).toBe(false); // not TOP-level .design/
    expect(isDesignArtefact("assets/design/hero.html")).toBe(false);
    expect(isDesignArtefact("mockups/hero.html")).toBe(false); // plain html, not .dc.html
    expect(isDesignArtefact(".designrc")).toBe(false); // a dotfile, not the directory
    expect(isDesignArtefact(".designs/hero.html")).toBe(false); // different directory
  });
});

describe("isDesignOnlyChangeSet", () => {
  it("is true when every file is a design artefact", () => {
    expect(isDesignOnlyChangeSet([{ path: ".design/hero.dc.html" }])).toBe(true);
    expect(
      isDesignOnlyChangeSet([
        { path: ".design/a.dc.html" },
        { path: "mockups/b.dc.html" },
      ]),
    ).toBe(true);
  });

  it("is false for an EMPTY change set (fail-closed: nothing to exempt)", () => {
    expect(isDesignOnlyChangeSet([])).toBe(false);
  });

  it("is false for a MIXED change set (the source change is what the gate is for)", () => {
    expect(
      isDesignOnlyChangeSet([{ path: ".design/hero.dc.html" }, { path: "src/app.ts" }]),
    ).toBe(false);
  });

  it("is false when no file is a design artefact", () => {
    expect(isDesignOnlyChangeSet([{ path: "src/app.ts" }])).toBe(false);
  });
});
