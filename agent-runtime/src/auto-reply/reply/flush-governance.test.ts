/**
 * A memory flush whose tool calls a governance gate refused must say so, and the flush must not be recorded as done. The watch
 * reads the gate's structured answer from the run's tool events; the event here is the real one a gated channel run produces.
 */
import { describe, expect, it } from "vitest";
import { channelAgent, user } from "../../infra/host-policy-gates.testkit.js";
import { watchFlushRefusals } from "./flush-governance.js";

/** Run the model-asks-for-exec scenario under `gates` and hand every resulting tool-result event to a watch. */
async function watchedRun(gates: Parameters<typeof channelAgent>[0]) {
  const watch = watchFlushRefusals();
  const { agent } = channelAgent(gates, []);
  agent.subscribe((e) => {
    if (e.type === "tool_execution_end") {
      watch.observe({ stream: "tool", data: { phase: "result", name: e.toolName, isError: e.isError, result: e.result } });
    }
  });
  await agent.prompt([user("flush your notes")]);
  return watch;
}

describe("watchFlushRefusals", () => {
  it("names the gate that refused a tool call (blocked)", async () => {
    const watch = await watchedRun([{ id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" }]);
    expect(watch.gates()).toEqual(["no-shell"]);
  });

  it("names the gate when an approval gate refused it too", async () => {
    const watch = await watchedRun([{ id: "ask-first", tool: "exec", effect: "require-approval" }]);
    expect(watch.gates()).toEqual(["ask-first"]);
  });

  it("says nothing when no gate refused anything", async () => {
    const watch = await watchedRun([]);
    expect(watch.gates()).toEqual([]);
  });

  it("ignores an ordinary tool failure, a success and other streams", () => {
    const watch = watchFlushRefusals();
    watch.observe({ stream: "tool", data: { phase: "result", isError: true, result: { content: [{ type: "text", text: "ENOENT: no such file" }] } } });
    watch.observe({ stream: "tool", data: { phase: "result", isError: false, result: { content: [{ type: "text", text: '{"gate":"x"}' }] } } });
    watch.observe({ stream: "compaction", data: { phase: "end" } });
    watch.observe({ stream: "tool", data: { phase: "start" } });
    expect(watch.gates()).toEqual([]);
  });
});
