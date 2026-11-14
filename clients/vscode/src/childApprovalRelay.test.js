import { describe, expect, it, vi } from "vitest";
import { createChildApprovalRelay } from "./childApprovalRelay";
/** A child's write prompt reaches an owner that cannot render a run cell — once, and never twice-answered. */
const lineage = { rootChatId: 7, agent: { ref: "a1", name: "Ada" } };
function setup() {
    let pending = null;
    const resolve = vi.fn((_key, _ok) => {
        pending = null;
    });
    const relay = createChildApprovalRelay({
        registry: { lineageOf: (key) => (key === -1 ? lineage : null) },
        pendingOf: () => pending,
        resolve,
    });
    relay.describeWith(-1, (name, args) => ({ name, args: args, label: `edit ${name}` }));
    return { relay, resolve, pause: (p) => (pending = p), current: () => pending };
}
describe("childApprovalRelay", () => {
    it("asks the chat's approver with the child's name and applies its answer", async () => {
        const { relay, resolve, pause } = setup();
        const approve = vi.fn(async (_req) => true);
        relay.register(7, approve);
        pause({ name: "write_file", args: { path: "a.ts" } });
        relay.changed(-1);
        relay.changed(-1);
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith(-1, true));
        expect(approve).toHaveBeenCalledTimes(1);
        expect(approve.mock.calls[0][0]).toMatchObject({ agentName: "Ada", label: "edit write_file" });
    });
    it("drops a late answer when the panel already answered", async () => {
        const { relay, resolve, pause } = setup();
        let answer = () => undefined;
        relay.register(7, () => new Promise((r) => (answer = r)));
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
        const approve = vi.fn(async (_req) => true);
        pause({ name: "write_file", args: {} });
        relay.changed(-1);
        relay.register(7, approve);
        relay.changed(5);
        expect(approve).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=childApprovalRelay.test.js.map