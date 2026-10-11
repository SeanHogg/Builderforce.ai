import { describe, expect, it, vi } from "vitest";
import { createChildApprovalRelay } from "./childApprovalRelay";

/** A child's write prompt reaches an owner that cannot render a run cell — once, and never twice-answered. */

const lineage = { rootChatId: 7, agent: { ref: "a1", name: "Ada" } };

function setup() {
  let pending: { name: string; args: unknown } | null = null;
  const resolve = vi.fn((_key: number, _ok: boolean) => {
    pending = null;
  });
  const relay = createChildApprovalRelay({
    registry: { lineageOf: (key: number) => (key === -1 ? (lineage as never) : null) },
    pendingOf: () => pending,
    resolve,
  });
  relay.describeWith(-1, (name, args) => ({ name, args: args as Record<string, unknown>, label: `edit ${name}` }));
  return { relay, resolve, pause: (p: { name: string; args: unknown } | null) => (pending = p), current: () => pending };
}

describe("childApprovalRelay", () => {
  it("asks the chat's approver with the child's name and applies its answer", async () => {
    const { relay, resolve, pause } = setup();
    const approve = vi.fn(async (_req: { agentName?: string; label?: string }) => true);
    relay.register(7, approve);
    pause({ name: "write_file", args: { path: "a.ts" } });
    relay.changed(-1);
    relay.changed(-1);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith(-1, true));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]![0]).toMatchObject({ agentName: "Ada", label: "edit write_file" });
  });

  it("drops a late answer when the panel already answered", async () => {
    const { relay, resolve, pause } = setup();
    let answer: (ok: boolean) => void = () => undefined;
    relay.register(7, () => new Promise<boolean>((r) => (answer = r)));
    pause({ name: "write_file", args: {} });
    relay.changed(-1);
    pause(null);
    answer(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves runs alone that are not children, or whose chat has no approver", () => {
    const { relay, pause } = setup();
    const approve = vi.fn(async (_req: { agentName?: string; label?: string }) => true);
    pause({ name: "write_file", args: {} });
    relay.changed(-1);
    relay.register(7, approve);
    relay.changed(5);
    expect(approve).not.toHaveBeenCalled();
  });
});
