/**
 * The pure seams the host and the native participant share: the tool labels and confirm predicate (`nativeRunTool.ts`), the
 * stream relay, the budget check and the transient persistence (`nativeRunStream.ts`), and the gateway transport
 * (`nativeGatewayStream.ts`). Moved unchanged from the retired participant runner's test.
 */

import { describe, expect, it } from "vitest";
import type { PolicyGate } from "@builderforce/agent-tools";
import { shipPolicyOf } from "@builderforce/run-guards";
import type { ToolDef } from "../tools/fileTools";
import { nativeNeedsConfirm, parseToolOutput, toolLabel } from "./nativeRunTool";
import { createStreamRelay, exhaustedToolBudget, transientRunPersistence } from "./nativeRunStream";
import { createNativeStream, SURFACE_HEADER, SURFACE_VALUE } from "./nativeGatewayStream";

function toolDef(name: string, opts: { mutating?: boolean; remote?: boolean } = {}): ToolDef {
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: "object", properties: {} },
    mutating: opts.mutating ?? false,
    ...(opts.remote ? { remote: true } : {}),
    async execute() {
      return JSON.stringify({ ok: true });
    },
  };
}

describe("toolLabel", () => {
  const defs = [toolDef("write_file", { mutating: true }), toolDef("builtin_tasks_create", { remote: true })];

  it("uses the local phrasing for a workspace tool", () => {
    expect(toolLabel(defs, "write_file", { path: "src/a.ts" })).toBe("write src/a.ts");
  });

  it("uses the verb-plus-subject phrasing for a platform tool", () => {
    expect(toolLabel(defs, "builtin_tasks_create", { title: "Ship it" })).toBe("tasks create: Ship it");
    expect(toolLabel(defs, "builtin_tasks_create", {})).toBe("tasks create");
  });
});

describe("nativeNeedsConfirm", () => {
  const defs = [toolDef("write_file", { mutating: true }), toolDef("read_file")];

  it("pauses on a mutating tool in ask mode and not in acceptEdits", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "write_file", args: {} })).toBe(true);
    expect(nativeNeedsConfirm(defs, "acceptEdits", undefined)({ name: "write_file", args: {} })).toBe(false);
  });

  it("never pauses on a read-only tool", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "read_file", args: {} })).toBe(false);
  });

  it("treats an unknown tool as mutating", () => {
    expect(nativeNeedsConfirm(defs, "ask", undefined)({ name: "mystery", args: {} })).toBe(true);
  });

  it("does not pause on a path-scoped require-approval gate in acceptEdits (Auto overrides governance)", () => {
    const gates: PolicyGate[] = [
      { id: "review-secret", tool: "write_file", effect: "require-approval", paths: ["src/secret/**"], reason: "secrets need a reviewer" },
    ];
    expect(nativeNeedsConfirm(defs, "acceptEdits", gates)({ name: "write_file", args: { path: "src/secret/x.ts" } })).toBe(false);
    expect(nativeNeedsConfirm(defs, "acceptEdits", gates)({ name: "write_file", args: { path: "README.md" } })).toBe(false);
  });

  it("still pauses on a path-scoped require-approval gate in ask mode", () => {
    const gates: PolicyGate[] = [
      { id: "review-secret", tool: "write_file", effect: "require-approval", paths: ["src/secret/**"], reason: "secrets need a reviewer" },
    ];
    expect(nativeNeedsConfirm(defs, "ask", gates)({ name: "write_file", args: { path: "src/secret/x.ts" } })).toBe(true);
    expect(nativeNeedsConfirm(defs, "ask", gates)({ name: "write_file", args: { path: "README.md" } })).toBe(true);
  });

  describe("a publish the run's ship policy allows (PRD 48)", () => {
    const publish = [...defs, toolDef("git_commit", { mutating: true }), toolDef("git_push", { mutating: true }), toolDef("run_command", { mutating: true })];
    const commitPush = shipPolicyOf("commit_push", "project_settings");

    it("regression: chat #157440 — a push the ship policy allows is not held for approval", () => {
      expect(nativeNeedsConfirm(publish, "ask", undefined)({ name: "git_commit", args: { paths: ["a.ts"], allowBaseBranch: true }, shipPolicy: commitPush })).toBe(false);
      expect(nativeNeedsConfirm(publish, "ask", undefined)({ name: "git_push", args: { allowBaseBranch: true }, shipPolicy: commitPush })).toBe(false);
    });

    it("still shows the card when a governance gate requires approval", () => {
      const gates: PolicyGate[] = [{ id: "push-review", tool: "git_push", effect: "require-approval", reason: "pushes need a reviewer" }];
      expect(nativeNeedsConfirm(publish, "ask", gates)({ name: "git_push", args: { allowBaseBranch: true }, shipPolicy: commitPush })).toBe(true);
    });

    it("asks as before for a publish the policy does not allow, a non-publish, or no policy", () => {
      const commitOnly = shipPolicyOf("commit", "project_settings");
      expect(nativeNeedsConfirm(publish, "ask", undefined)({ name: "git_push", args: { allowBaseBranch: true }, shipPolicy: commitOnly })).toBe(true);
      expect(nativeNeedsConfirm(publish, "ask", undefined)({ name: "run_command", args: { command: "pnpm test" }, shipPolicy: commitPush })).toBe(true);
      expect(nativeNeedsConfirm(publish, "ask", undefined)({ name: "git_push", args: { allowBaseBranch: true } })).toBe(true);
    });
  });
});

describe("parseToolOutput", () => {
  it("parses a JSON envelope so the loop can see ok:false and a created id", () => {
    expect(parseToolOutput('{"ok":false,"error":"nope"}')).toEqual({ ok: false, error: "nope" });
    expect(parseToolOutput("[{\"id\":1}]")).toEqual([{ id: 1 }]);
  });

  it("leaves prose alone", () => {
    expect(parseToolOutput("wrote 3 lines")).toBe("wrote 3 lines");
    expect(parseToolOutput("{not json")).toBe("{not json");
  });
});

describe("createStreamRelay", () => {
  const snapshot = (streamingText: string, appended: Array<{ id: number; content: string }>) =>
    ({ streamingText, appended } as never);

  it("emits streamed deltas once and skips the committed twin", () => {
    let text = "";
    const relay = createStreamRelay({ onText: (d) => { text += d; } });
    relay(snapshot("Hel", []));
    relay(snapshot("Hello", []));
    relay(snapshot("Hello", [{ id: -1, content: "Hello" }]));
    relay(snapshot("", [{ id: -1, content: "Hello" }]));
    expect(text).toBe("Hello");
  });

  it("emits a message that was never streamed — the memory-first answer", () => {
    let text = "";
    const relay = createStreamRelay({ onText: (d) => { text += d; } });
    relay(snapshot("", [{ id: -1, content: "From memory." }]));
    expect(text.trim()).toBe("From memory.");
  });
});

describe("exhaustedToolBudget", () => {
  it("recognises the forced final synthesis and the give-up step", () => {
    expect(exhaustedToolBudget([{ ts: "", category: "llm", label: "llm.complete", args: { forcedFinish: true } }])).toBe(true);
    expect(exhaustedToolBudget([{ ts: "", category: "error", label: "agent.loop", isError: true }])).toBe(true);
    expect(exhaustedToolBudget([{ ts: "", category: "llm", label: "llm.complete", args: { step: 0 } }])).toBe(false);
  });
});

describe("createNativeStream", () => {
  it("tags every completion with the vsix surface header so metering attributes it", async () => {
    const seen: Array<Record<string, string>> = [];
    const stream = createNativeStream("https://gateway.test", "key-123", async (_input, init) => {
      seen.push(init.headers as Record<string, string>);
      // An empty SSE body is enough: we are asserting the REQUEST, not the parse.
      return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    await stream({ messages: [{ role: "user", content: "hi" }] });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[SURFACE_HEADER]).toBe(SURFACE_VALUE);
    expect(seen[0]?.Authorization).toBe("Bearer key-123");
  });
});

describe("transientRunPersistence", () => {
  it("mints negative ids so an in-run write is never mistaken for a stored message", async () => {
    const p = transientRunPersistence();
    const [one, two] = await p.sendMessages(1, [
      { role: "assistant", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    expect(one?.id).toBeLessThan(0);
    expect(two?.id).toBeLessThan(0);
    expect(one?.id).not.toBe(two?.id);
    expect(one?.content).toBe("a");
  });
});
