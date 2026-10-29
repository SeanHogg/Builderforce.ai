/**
 * Test — D7's post-edit check, ported from `api/.../costLoop/postEditVerify.test.ts`. Inputs and expected values are the
 * source's; the engine's repo context is the guards' `read` port (the ref it reads — the ticket branch — is the cloud
 * adapter's, `cloudAdapterHooks`) and "an unbound repo" is `bound: false`.
 */
import { describe, expect, it, vi } from "vitest";
import { verifyAfterEdit, withPostEditNote } from "../../src/policy/guards/postEdit.js";

describe("verifyAfterEdit (D7)", () => {
  it("checks a write on the bytes it sent, without reading back", async () => {
    const read = vi.fn();
    const v = await verifyAfterEdit({ name: "write_file", args: { path: "a.json", content: '{"x":' } }, { ok: true }, { read });
    expect(v?.ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("checks an edit on the committed result", async () => {
    const read = vi.fn(async () => "a: [1, 2");
    const v = await verifyAfterEdit({ name: "edit_file", args: { path: "b.yaml", old_string: "x", new_string: "y" } }, { ok: true }, { read });
    expect(v?.ok).toBe(false);
    expect(read).toHaveBeenCalledWith("b.yaml");
  });

  it("has nothing to say about a failed edit, a non-edit, an unbound repo or an unchecked file type", async () => {
    const read = async () => null;
    expect(await verifyAfterEdit({ name: "write_file", args: { path: "a.json", content: "{" } }, { ok: false }, { read })).toBeNull();
    expect(await verifyAfterEdit({ name: "read_file", args: { path: "a.json" } }, { ok: true }, { read })).toBeNull();
    expect(await verifyAfterEdit({ name: "write_file", args: { path: "a.json", content: "{" } }, { ok: true }, { bound: false })).toBeNull();
    expect(await verifyAfterEdit({ name: "write_file", args: { path: "README.md", content: "#" } }, { ok: true }, { read })).toBeNull();
  });

  it("adds one note on a failure and nothing on a pass", async () => {
    const read = async () => null;
    const bad = await verifyAfterEdit({ name: "write_file", args: { path: "a.json", content: "{" } }, { ok: true }, { read });
    expect((withPostEditNote({ ok: true }, bad) as { note: string }).note).toMatch(/^Post-edit check FAILED[\s\S]*a\.json/);
    const good = await verifyAfterEdit({ name: "write_file", args: { path: "a.json", content: "{}" } }, { ok: true }, { read });
    expect(withPostEditNote({ ok: true }, good)).toEqual({ ok: true });
  });
});
