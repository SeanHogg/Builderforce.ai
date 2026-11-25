import { describe, expect, it, vi } from "vitest";
import { readLocalFirst } from "./localRead";

const snapshot = { source: "snapshot", title: "from-json" };

describe("readLocalFirst", () => {
  it("returns the present local object, not a merge with the snapshot", () => {
    const fetchSpy = vi.fn();
    const prior = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const local = { source: "local", title: "from-store", onlyLocal: true };
      const read = readLocalFirst(local, { ...snapshot, extra: "snapshot-only" });
      expect(read).toBe(local);
      expect(read).toEqual({ source: "local", title: "from-store", onlyLocal: true });
      expect(read).not.toHaveProperty("extra");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = prior;
    }
  });

  it("returns the snapshot when local is null", () => {
    expect(readLocalFirst(null, snapshot)).toBe(snapshot);
  });

  it("returns the snapshot when local is undefined", () => {
    expect(readLocalFirst(undefined, snapshot)).toBe(snapshot);
  });

  it("lets an empty local object win over the snapshot", () => {
    const local = {};
    const read = readLocalFirst(local, snapshot);
    expect(read).toBe(local);
    expect(read).toEqual({});
    expect(read).not.toBe(snapshot);
  });
});
