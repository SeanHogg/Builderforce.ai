/**
 * The announced deliverable at settle: a final, tool-free reply that announces a deliverable it never produced gets ONE
 * more turn with a steer to produce it (VS Code chat #273 settled on "I have enough to write the ≤800-word alignment report.").
 */

import { describe, expect, it } from "vitest";
import { initialRunPolicy } from "@builderforce/run-policy";
import { ANNOUNCED_DELIVERABLE_STEER } from "@builderforce/run-guards";
import { ANNOUNCED_DELIVERABLE_ID, stallHook } from "../../src/policy/stall/index.js";
import type { PolicyContext } from "../../src/policy/hooks.js";

const CHAT_273 = "I have enough to write the ≤800-word alignment report.";

function ctx(text: string, state?: PolicyContext["state"]): PolicyContext {
  return {
    task: { prompt: "Write an alignment report of the PRDs against the roadmap", dispatch: { source: "chat" } },
    policy: {
      entryPoint: "vscode", toolScope: "chat-work", role: "general", levers: [], budgets: {},
      inference: "hybrid", verify: "none", approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    },
    state: state ?? ({ model: initialRunPolicy() } as unknown as PolicyContext["state"]),
    ports: {} as PolicyContext["ports"],
    step: 1,
    turn: 1,
    messages: [],
    tools: ["read_file", "write_file"].map((name) => ({
      type: "function" as const,
      function: { name, description: "", parameters: { type: "object" as const } },
    })),
    content: text,
  };
}

describe("stallHook: announced deliverable at settle", () => {
  it("steers chat #273's closing claim once, with the write-it-now note", async () => {
    const c = ctx(CHAT_273);
    const decision = await stallHook.recoverAsync(c);
    expect(decision).toMatchObject({ action: "steer", note: ANNOUNCED_DELIVERABLE_STEER, detail: { shape: "announced-deliverable" } });
    expect(c.state.stall?.said).toContain(ANNOUNCED_DELIVERABLE_ID);
  });

  it("never loops: the second announcement in the same run settles", async () => {
    const first = ctx(CHAT_273);
    expect(await stallHook.recoverAsync(first)).toMatchObject({ action: "steer" });
    const again = ctx("Next I'll write the report.", first.state);
    expect(await stallHook.recoverAsync(again)).toBeUndefined();
  });

  it("accepts a reply that IS the deliverable", async () => {
    const answer = "## Alignment report\n\nThe PRDs and the roadmap agree on scope. Two gaps remain: auth and billing.";
    expect(stallHook.recover(ctx(answer))).toBeUndefined();
  });
});
