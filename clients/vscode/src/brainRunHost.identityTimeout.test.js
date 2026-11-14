/**
 * The identity bind a run awaits before turn 1 is bounded (PRD 36): `chatIdentity` reaches
 * over the network, and a slow or unreachable endpoint must not hold the run. The bound is
 * on `bindIdentityWithin` in `brainRunHost.ts`; on a timeout — or a rejected bind, the same
 * shape the production port reports — the run degrades to the UNBOUND identity and proceeds
 * on the local path instead of hanging.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const seen = vi.hoisted(() => ({ requests: [] }));
vi.mock("@seanhogg/builderforce-brain-embedded", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        startRun: (key, req) => {
            seen.requests.push(req);
            return actual.startRun(key, req);
        },
    };
});
const { resetBrainRunStore } = await import("@seanhogg/builderforce-brain-embedded");
const { fakeGateway } = await import("../harness/fakeGateway");
const { createBrainRunHost, CHAT_IDENTITY_TIMEOUT_MS } = await import("./brainRunHost");
const { transientRunPersistence } = await import("./nativeBrainRun");
beforeEach(() => {
    resetBrainRunStore();
    seen.requests.length = 0;
});
function hostFor(chatIdentity) {
    const gateway = fakeGateway([{ text: "ok" }]);
    return createBrainRunHost({
        tools: async () => [],
        workspaceRoot: () => "/workspace",
        stream: async () => gateway.stream,
        persistence: transientRunPersistence(),
        evermind: () => undefined,
        labels: { blockedByPolicy: (r) => `blocked: ${r}` },
        chatIdentity,
    });
}
describe("the identity bind a run awaits before turn 1", () => {
    it("names the bound server chat when the bind resolves in time", async () => {
        const host = hostFor(async () => ({ serverChatId: 991, clientChatId: "client-abc" }));
        await host.start({ chatId: 7201, systemPrompt: "s", userTurn: "hi", autoApprove: true, evermind: false });
        expect(seen.requests).toHaveLength(1);
        expect(seen.requests[0]).toMatchObject({ serverChatId: 991, clientChatId: "client-abc" });
    });
    it("degrades to the unbound identity (local path) when the bind hangs past the timeout", async () => {
        vi.useFakeTimers();
        try {
            const chatIdentity = vi.fn(async () => new Promise(() => undefined));
            const host = hostFor(chatIdentity);
            const settled = host.start({ chatId: 7202, systemPrompt: "s", userTurn: "hi", autoApprove: true, evermind: false });
            // Let the real gateway script and the setup ticks run; the bind itself never resolves.
            await vi.advanceTimersByTimeAsync(CHAT_IDENTITY_TIMEOUT_MS + 1);
            await settled; // does NOT hang past the timeout — the run settles
            expect(chatIdentity).toHaveBeenCalledTimes(1);
            expect(seen.requests).toHaveLength(1);
            // Unbound: NO serverChatId named, so the run runs on the local chat id.
            expect(seen.requests[0]).not.toHaveProperty("serverChatId");
            expect(seen.requests[0]).not.toHaveProperty("clientChatId");
        }
        finally {
            vi.useRealTimers();
        }
    });
    it("degrades to the unbound identity when the bind rejects — never fails the run", async () => {
        const host = hostFor(async () => {
            throw new Error("network unreachable");
        });
        await host.start({ chatId: 7203, systemPrompt: "s", userTurn: "hi", autoApprove: true, evermind: false });
        expect(seen.requests).toHaveLength(1);
        expect(seen.requests[0]).not.toHaveProperty("serverChatId");
    });
    it("honours a shorter port-level timeout when one is set", async () => {
        vi.useFakeTimers();
        try {
            const gateway = fakeGateway([{ text: "ok" }]);
            const host = createBrainRunHost({
                tools: async () => [],
                workspaceRoot: () => "/workspace",
                stream: async () => gateway.stream,
                persistence: transientRunPersistence(),
                evermind: () => undefined,
                labels: { blockedByPolicy: (r) => `blocked: ${r}` },
                chatIdentityTimeoutMs: 50,
                chatIdentity: async () => new Promise(() => undefined),
            });
            const settled = host.start({ chatId: 7204, systemPrompt: "s", userTurn: "hi", autoApprove: true, evermind: false });
            await vi.advanceTimersByTimeAsync(60);
            await settled;
            expect(seen.requests).toHaveLength(1);
            expect(seen.requests[0]).not.toHaveProperty("serverChatId");
        }
        finally {
            vi.useRealTimers();
        }
    });
});
//# sourceMappingURL=brainRunHost.identityTimeout.test.js.map