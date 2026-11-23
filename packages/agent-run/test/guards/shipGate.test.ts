import { describe, expect, it, vi } from "vitest";
import type { ShipPolicy } from "@builderforce/run-guards";
import type { GuardsHook } from "../../src/policy/hooks.js";
import { withShipGate } from "../../src/policy/guards/shipGate.js";

const cloudPolicy: ShipPolicy = { mode: "pull_request", merge: "on_green", review: "none", source: "project_settings" };
const inner = (): GuardsHook => ({ observe: vi.fn(), beforeDispatch: vi.fn(() => undefined) }) as unknown as GuardsHook;
const ctx = {} as never;

describe("withShipGate — PRD 48 §4.2, the cloud run never pushes the base branch", () => {
  it("refuses a raw push to main before it dispatches, with the policy's own words", async () => {
    const guards = inner();
    const refused = vi.fn();
    const gated = withShipGate(guards, { policy: cloudPolicy, onRefused: refused });
    const out = await gated.beforeDispatch!(ctx, { id: "1", name: "run_command", args: { command: "git push origin main" } });
    expect(out).toMatchObject({ skip: { isError: true, data: { ok: false } } });
    expect(String((out as { skip: { data: { error: string } } }).skip.data.error)).toContain("Ship policy refused");
    expect(refused).toHaveBeenCalledWith("run_command", expect.stringContaining("pull_request"));
    expect(guards.beforeDispatch).not.toHaveBeenCalled();
  });

  it.each([
    "git push origin 'main'",
    'bash -c "git push origin main"',
    "echo $(git push origin main)",
    "git push origin develop",
    "git push origin trunk",
    "git push origin builderforce/task-7",
    "gh pr create --fill",
    "gh api -X PUT repos/acme/app/pulls/3/merge",
  ])("refuses every raw shell push, PR or merge — %s", async (command) => {
    const guards = inner();
    const out = await withShipGate(guards, { policy: cloudPolicy }).beforeDispatch!(ctx, { id: "1", name: "run_command", args: { command } });
    expect(out).toMatchObject({ skip: { isError: true } });
    expect(guards.beforeDispatch).not.toHaveBeenCalled();
  });

  it("lets non-publish calls through to the inner guards", async () => {
    const guards = inner();
    const gated = withShipGate(guards, { policy: cloudPolicy });
    expect(await gated.beforeDispatch!(ctx, { id: "1", name: "run_command", args: { command: "pnpm test" } })).toBeUndefined();
    expect(await gated.beforeDispatch!(ctx, { id: "2", name: "write_file", args: { path: "a.ts" } })).toBeUndefined();
    expect(guards.beforeDispatch).toHaveBeenCalledTimes(2);
  });

  it("is the inner hook unchanged when the run has no ship policy", () => {
    const guards = inner();
    expect(withShipGate(guards, undefined)).toBe(guards);
  });
});
