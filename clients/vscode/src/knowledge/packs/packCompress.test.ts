import { describe, expect, it } from "vitest";
import { methodologyPackActive, packWritePath } from "./packCompress";

describe("pack compression", () => {
  it("appends .gz unless compress is off", () => {
    expect(packWritePath("packs/codebase.bfpack")).toBe("packs/codebase.bfpack.gz");
    expect(packWritePath("packs/codebase.bfpack", false)).toBe("packs/codebase.bfpack");
  });

  it("attaches the methodology pack only while a role is on", () => {
    expect(methodologyPackActive([{ persona: { role: null } }])).toBe(false);
    expect(methodologyPackActive([{ persona: { role: "analyst" } }])).toBe(true);
  });
});
