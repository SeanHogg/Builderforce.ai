import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootPolicy,
  isDefaultAllowDecision,
  retainOnSignOut,
  type PlatformBootDecision,
  type RetainedPolicySnapshot,
} from "./policySnapshotRetention";

const DENY: PlatformBootDecision = { allowsPlatform: false, reason: "tenant-gates" };
const GRANTED: PlatformBootDecision = { allowsPlatform: true, reason: "operator-enabled-sync" };

function snapshot(decision: PlatformBootDecision, id = "policy-snapshot:project:7"): RetainedPolicySnapshot & { id: string } {
  return { id, decision };
}

describe("retainOnSignOut", () => {
  it("returns the same snapshot", () => {
    const held = snapshot(DENY);
    expect(retainOnSignOut(held)).toBe(held);
  });

  it("never returns null", () => {
    expect(retainOnSignOut(snapshot(DENY))).not.toBeNull();
    expect(() => retainOnSignOut(null)).toThrow(/refusing null/);
    expect(() => retainOnSignOut(undefined)).toThrow(/refusing null/);
  });

  it("never returns a default-allow", () => {
    const held = retainOnSignOut(snapshot(DENY));
    expect(isDefaultAllowDecision(held.decision)).toBe(false);
    expect(held.decision.allowsPlatform).toBe(false);

    expect(() => retainOnSignOut(snapshot({ allowsPlatform: true, reason: "default-allow" }))).toThrow(/default-allow/);
    expect(() => retainOnSignOut(snapshot({ allowsPlatform: true, reason: "  " }))).toThrow(/default-allow/);
    expect(() => retainOnSignOut({ decision: undefined as unknown as PlatformBootDecision })).toThrow(/default-allow/);
  });

  it("keeps an explicit platform grant that is not a default-allow", () => {
    const held = snapshot(GRANTED);
    expect(retainOnSignOut(held)).toBe(held);
    expect(held.decision).toEqual(GRANTED);
  });
});

describe("bootPolicy", () => {
  it("denies platform calls when nothing is stored", () => {
    expect(bootPolicy(null)).toEqual({ allowsPlatform: false, reason: "no_snapshot" });
    expect(bootPolicy(undefined)).toEqual({ allowsPlatform: false, reason: "no_snapshot" });
  });

  it("returns the stored decision when a snapshot exists", () => {
    const held = snapshot(DENY);
    expect(bootPolicy(held)).toBe(held.decision);
    expect(bootPolicy(snapshot(GRANTED))).toEqual(GRANTED);
  });

  it("does not invent a default-allow for a missing snapshot", () => {
    const decision = bootPolicy(undefined);
    expect(decision.allowsPlatform).toBe(false);
    expect(isDefaultAllowDecision(decision)).toBe(false);
  });
});

describe("policySnapshotRetention module", () => {
  it("does not import vscode", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "policySnapshotRetention.ts"), "utf8");
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).not.toMatch(/import \* as vscode/);
  });
});
