import { describe, expect, it } from "vitest";
import { sha256Hex } from "@seanhogg/builderforce-memory/knowledge";
import { nodeSha256Hex } from "./nodeSha256";

describe("nodeSha256Hex", () => {
  it("is the same lowercase hex digest as memory's sha256Hex", () => {
    for (const text of ["", "abc", "héllo wörld\n".repeat(1000)]) {
      const bytes = new TextEncoder().encode(text);
      expect(nodeSha256Hex(bytes)).toBe(sha256Hex(bytes));
    }
    expect(nodeSha256Hex(new Uint8Array(70_000).fill(255))).toBe(sha256Hex(new Uint8Array(70_000).fill(255)));
  });
});
