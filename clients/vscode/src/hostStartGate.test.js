import { describe, expect, it, vi } from "vitest";
import { gateStarts } from "./hostStartGate";
// A Stop that landed while the editor's start captured its change-set baseline (before the
// host claimed the chat) was dropped by the host, and the run started anyway.
function setup() {
    const calls = [];
    const host = {
        start: vi.fn(async () => void calls.push("start")),
        stop: vi.fn((key) => void calls.push(`stop ${key}`)),
        steer: vi.fn((key, text) => void calls.push(`steer ${key} ${text}`)),
        steerTurns: vi.fn((key, turns) => void calls.push(`steerTurns ${key} ${turns.map((t) => t.text).join("|")}`)),
    };
    let release;
    const baseline = new Promise((res) => (release = res));
    const gated = gateStarts(host, async (_payload, start) => {
        await baseline;
        await start();
    });
    return { calls, gated, release };
}
const payload = { chatId: 7 };
describe("gateStarts", () => {
    it("hands a Stop asked during the baseline to the host once it has the chat", async () => {
        const { calls, gated, release } = setup();
        const started = gated.start(payload);
        gated.stop(7);
        release();
        await started;
        expect(calls).toEqual(["stop 7", "start", "stop 7"]);
    });
    it("holds a typed stop the same way, and leaves other words alone", async () => {
        const { calls, gated, release } = setup();
        const started = gated.start(payload);
        gated.steer(7, "keep going");
        gated.steer(7, "Stop the run");
        release();
        await started;
        expect(calls).toEqual(["steer 7 keep going", "steer 7 Stop the run", "start", "stop 7"]);
    });
    it("holds a typed stop among SEVERAL turns the same way", async () => {
        const { calls, gated, release } = setup();
        const started = gated.start(payload);
        gated.steerTurns(7, [{ text: "keep going", eventKey: "k1" }, { text: "Stop the run", eventKey: "k2" }]);
        release();
        await started;
        expect(calls).toEqual(["steerTurns 7 keep going|Stop the run", "start", "stop 7"]);
    });
    it("does not stop a run nobody asked to stop, or another chat", async () => {
        const { calls, gated, release } = setup();
        const started = gated.start(payload);
        gated.stop(8);
        release();
        await started;
        expect(calls).toEqual(["stop 8", "start"]);
        gated.stop(7);
        expect(calls).toEqual(["stop 8", "start", "stop 7"]);
    });
});
//# sourceMappingURL=hostStartGate.test.js.map