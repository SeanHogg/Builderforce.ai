/**
 * Test — with every guard lever off, the guards pass every call through untouched (the api `LoopGuards — levers off ›
 * passes every hook and port through` case, ported to `RunGuards`): no read is parallel, and a broken write is not
 * noted on its result.
 */
import { describe, expect, it } from "vitest";
import { RunGuards } from "../../src/policy/guards/index.js";

describe("RunGuards — levers off pass every call through", () => {
  it("returns the very result it was handed, and offers no parallel read", async () => {
    const guards = new RunGuards({}, undefined, {});
    expect(guards.isReadOnly("read_file")).toBe(false);
    const result = { ok: true, echoed: "write_file" };
    const out = await guards.checkEdit({ id: "a", name: "write_file", args: { path: "x.json", content: "{" } }, result, {});
    // (call, data, ports): levers off ⇒ the data comes back as the same object.
    expect(out).toBe(result);
    expect(out).toEqual({ ok: true, echoed: "write_file" });
    expect(guards.snapshot()).toEqual({});
  });
});
