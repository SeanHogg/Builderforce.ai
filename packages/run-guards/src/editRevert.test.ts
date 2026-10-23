import { describe, expect, it } from "vitest";
import { EditRevertTracker, changesContent } from "./editRevert.js";

const ok = { ok: true };

describe("EditRevertTracker", () => {
  it("flags a write that restores an earlier write of the same path", () => {
    const t = new EditRevertTracker();
    expect(t.record("write_file", { path: "a.ts", content: "A" }, ok)).toBeNull();
    expect(t.record("write_file", { path: "a.ts", content: "B" }, ok)).toBeNull();
    expect(t.record("write_file", { path: "a.ts", content: "A" }, ok)).toEqual({ path: "a.ts", tool: "write_file", restores: "write" });
  });

  it("does not call an identical consecutive write a revert (that is a repeat)", () => {
    const t = new EditRevertTracker();
    t.record("write_file", { path: "a.ts", content: "A" }, ok);
    expect(t.record("write_file", { path: "a.ts", content: "A" }, ok)).toBeNull();
  });

  it("flags an edit that is the inverse of an earlier edit", () => {
    const t = new EditRevertTracker();
    expect(t.record("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok)).toBeNull();
    expect(t.record("edit_file", { path: "a.ts", old_string: "y", new_string: "x" }, ok)?.restores).toBe("inverse_edit");
  });

  it("does not match an inverse edit across a full write, or on another path", () => {
    const t = new EditRevertTracker();
    t.record("edit_file", { path: "a.ts", old_string: "x", new_string: "y" }, ok);
    t.record("write_file", { path: "a.ts", content: "fresh" }, ok);
    expect(t.record("edit_file", { path: "a.ts", old_string: "y", new_string: "x" }, ok)).toBeNull();
    t.record("edit_file", { path: "b.ts", old_string: "p", new_string: "q" }, ok);
    expect(t.record("edit_file", { path: "c.ts", old_string: "q", new_string: "p" }, ok)).toBeNull();
  });

  it("forgets a path on a failed change, a delete and a reset", () => {
    const t = new EditRevertTracker();
    t.record("write_file", { path: "a.ts", content: "A" }, ok);
    t.record("write_file", { path: "a.ts", content: "B" }, { ok: false });
    t.record("write_file", { path: "a.ts", content: "C" }, ok);
    expect(t.record("write_file", { path: "a.ts", content: "A" }, ok)).toBeNull();
    t.record("delete_file", { path: "a.ts" }, { ok: true, deleted: true });
    expect(t.snapshot()).toEqual([]);
  });

  it("round-trips its state", () => {
    const t = new EditRevertTracker();
    t.record("write_file", { path: "a.ts", content: "A" }, ok);
    t.record("write_file", { path: "a.ts", content: "B" }, ok);
    const resumed = new EditRevertTracker(JSON.parse(JSON.stringify(t.snapshot())));
    expect(resumed.record("write_file", { path: "a.ts", content: "A" }, ok)?.restores).toBe("write");
  });

  it("reads the change shape, not a tool list", () => {
    expect(changesContent({ path: "a", content: "" })).toBe(true);
    expect(changesContent({ path: "a", find: "1", replace: "2" })).toBe(true);
    expect(changesContent({ path: "a" })).toBe(false);
  });
});
