/**
 * A path-scoped gate must not be stepped around by how a path is spelled or how a patch is laid out: indented patch headers (the
 * applier accepts them), `./`, `..`, backslashes, an absolute path, and a patch we cannot read any file out of (fail closed).
 */

import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { evaluatePolicyGateSeam } from "../../src/index.js";

const SCOPED: PolicyGate[] = [{ id: "no-secrets", tool: "write_file", effect: "block", paths: ["secrets/**"], reason: "secrets" }];
const blocked = (tool: string, args: Record<string, unknown>) => evaluatePolicyGateSeam(SCOPED, tool, args).action === "block";
const patch = (...sections: string[]) => ({ input: ["*** Begin Patch", ...sections, "*** End Patch"].join("\n") });

describe("apply_patch headers", () => {
  it("reads indented headers, as the applier does", () => {
    expect(blocked("apply_patch", patch("   *** Update File: secrets/key.txt\n@@\n-a\n+b"))).toBe(true);
    expect(blocked("apply_patch", patch("\t*** Add File: secrets/new.txt\n+x"))).toBe(true);
    expect(blocked("apply_patch", patch("  *** Delete File: secrets/old.txt"))).toBe(true);
  });

  it("reads an indented Move to", () => {
    expect(blocked("apply_patch", patch("*** Update File: src/a.ts\n   *** Move to: secrets/a.ts\n@@\n-a\n+b"))).toBe(true);
  });

  it("allows a patch that stays outside the scope", () => {
    expect(blocked("apply_patch", patch("  *** Update File: src/a.ts\n@@\n-a\n+b"))).toBe(false);
  });

  it("FAILS CLOSED when a non-empty input names no file we can read: a path-scoped gate applies to it", () => {
    expect(blocked("apply_patch", { input: "this is not a patch" })).toBe(true);
    expect(blocked("apply_patch", { input: "*** Begin Patch\n*** Frobnicate File: secrets/x\n*** End Patch" })).toBe(true);
  });

  it("an empty input is not a patch: nothing to refuse", () => {
    expect(blocked("apply_patch", { input: "   " })).toBe(false);
    expect(blocked("apply_patch", {})).toBe(false);
  });
});

describe("path spellings", () => {
  it("resolves ./ and .. before matching", () => {
    expect(blocked("write_file", { path: "./secrets/key.txt" })).toBe(true);
    expect(blocked("write_file", { path: "src/../secrets/key.txt" })).toBe(true);
    expect(blocked("write_file", { path: "src/./../secrets/./key.txt" })).toBe(true);
  });

  it("reads backslashes", () => {
    expect(blocked("write_file", { path: "secrets\\key.txt" })).toBe(true);
    expect(blocked("write_file", { path: ".\\src\\..\\secrets\\key.txt" })).toBe(true);
  });

  it("matches an absolute path by its tail (the workspace root is not known at this seam: fail closed)", () => {
    expect(blocked("write_file", { path: "/home/dev/project/secrets/key.txt" })).toBe(true);
    expect(blocked("write_file", { path: "C:\\work\\project\\secrets\\key.txt" })).toBe(true);
  });

  it("matches a relative path that climbs out by its tail", () => {
    expect(blocked("write_file", { path: "../../secrets/key.txt" })).toBe(true);
  });

  it("does not over-reach onto a path that never touches the scope", () => {
    expect(blocked("write_file", { path: "src/a.ts" })).toBe(false);
    expect(blocked("write_file", { path: "./src/../docs/secrets.md" })).toBe(false);
    expect(blocked("write_file", { path: "/home/dev/project/src/a.ts" })).toBe(false);
  });

  it("a patch's file paths get the same treatment", () => {
    expect(blocked("apply_patch", patch("*** Add File: ./src/../secrets/new.txt\n+x"))).toBe(true);
    expect(blocked("apply_patch", patch("*** Add File: C:\\work\\secrets\\new.txt\n+x"))).toBe(true);
  });
});
