import { describe, expect, it } from "vitest";
import { JSON_KEY_READ_MAX_CHARS, readJsonKey } from "./jsonKeyRead.js";

const CATALOG = JSON.stringify({
  admin: {
    visitorFlow: { title: "Visitor flow", stat: { visitors: "Visitors" } },
    sessions: { title: "Adoption sessions" },
  },
  common: { view: "View" },
});

describe("readJsonKey", () => {
  it("returns the subtree at a dot path, pretty-printed", () => {
    const r = readJsonKey(CATALOG, "admin.visitorFlow");
    expect(r).toEqual({
      ok: true,
      key: "admin.visitorFlow",
      content: JSON.stringify({ title: "Visitor flow", stat: { visitors: "Visitors" } }, null, 2),
    });
  });

  it("returns a leaf value", () => {
    expect(readJsonKey(CATALOG, "common.view")).toEqual({ ok: true, key: "common.view", content: '"View"' });
  });

  it("names the keys that exist when a segment is missing", () => {
    const r = readJsonKey(CATALOG, "admin.visitor");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('admin has no "visitor"');
    expect(r.availableKeys).toEqual(["visitorFlow", "sessions"]);
  });

  it("lists child keys instead of returning a subtree too large to read whole", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) big[`k${i}`] = "x".repeat(20);
    const r = readJsonKey(JSON.stringify({ big }), "big");
    expect(r.ok && "tooLarge" in r).toBe(true);
    if (!r.ok || !("tooLarge" in r)) return;
    expect(r.size).toBeGreaterThan(JSON_KEY_READ_MAX_CHARS);
    expect(r.childKeys[0]).toBe("k0");
  });

  it("refuses a file that is not JSON, and tolerates a BOM", () => {
    expect(readJsonKey("not json", "a").ok).toBe(false);
    expect(readJsonKey("﻿{\"a\":1}", "a")).toEqual({ ok: true, key: "a", content: "1" });
  });
});
