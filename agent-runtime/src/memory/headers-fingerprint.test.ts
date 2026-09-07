import { describe, expect, it } from "vitest";
import { fingerprintHeaderNames } from "./headers-fingerprint.js";

describe("fingerprintHeaderNames", () => {
  it("returns [] for undefined or empty headers", () => {
    expect(fingerprintHeaderNames(undefined)).toEqual([]);
    expect(fingerprintHeaderNames({})).toEqual([]);
  });

  it("normalizes case/whitespace, sorts, and never includes values", () => {
    const out = fingerprintHeaderNames({
      " X-Deployment ": "blue",
      "api-version": "2025-01-01",
      Authorization: "Bearer secret",
    });
    expect(out).toEqual(["api-version", "authorization", "x-deployment"]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("is order- and case-insensitive so equivalent header sets fingerprint the same", () => {
    expect(fingerprintHeaderNames({ B: "1", a: "2" })).toEqual(
      fingerprintHeaderNames({ A: "x", b: "y" }),
    );
  });

  it("drops blank header names", () => {
    expect(fingerprintHeaderNames({ "  ": "v", ok: "v" })).toEqual(["ok"]);
  });
});
