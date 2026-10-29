/**
 * The on-prem conformance case (PRD 35 §3.3, WS5): the scripted task through
 * `runOnPremAgent` — its real transport seam, capability seam, steering channel and sinks —
 * asks the model the SAME things and ends in the SAME outcome as the agent driven directly
 * under another entry point's label, and the on-prem duties hold: a path-scoped `block`
 * refuses the call, a stop command surfaces as cancelled, a run that only yielded says so,
 * and a steer the run never reached goes back to the host instead of being dropped.
 *
 * (This lives here, not beside the other conformance cases in `packages/agent-run`, because
 * it drives the adapter itself, which is node-bound and cannot load in that package's
 * test environment.)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAgent } from "@builderforce/agent-run";
import type { ModelCompletion, ModelRequest, ModelTransport, RunOutcomeRow, RunPolicy } from "@builderforce/agent-run";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import { buildRunRowReport } from "../agents/embedded-runner/learned-routing/outcome-reporter.js";
import { createSteeringChannel } from "../infra/relay-steering.js";
import { runOnPremAgent, type OnPremRunParams } from "./onPremAdapter.js";

const CWD = "/work/ticket";
const PROMPT = "Say hello, then finish.";

const FINISH: ModelCompletion = { content: "", toolCalls: [{ id: "call-1", name: "finish", arguments: '{"summary":"Hello! Done."}' }], model: "fake-model" };
const READ: ModelCompletion = { content: "", toolCalls: [{ id: "r1", name: "read_file", arguments: '{"path":"a.ts"}' }] };
const WRITE_SECRET: ModelCompletion = { content: "", toolCalls: [{ id: "w1", name: "write_file", arguments: '{"path":"secrets/key.txt","content":"x"}' }] };

/** A model that replays a script and records what it was asked. */
function scripted(script: Array<ModelCompletion | Error>, requests: ModelRequest[] = [], onCall?: (n: number) => void): ModelTransport {
  let n = 0;
  return {
    complete: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
      onCall?.(n);
      const answer = script[n++];
      if (!answer) throw new Error("script exhausted");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function workspace(writes: string[] = []): CapabilityProvider {
  return {
    capabilities: new Set(["repo.read", "repo.write"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [] }),
      readFile: async (path: string) => ({ ok: true, path, content: "x" }),
      searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
    },
    repoWrite: {
      writeFile: async (path: string) => {
        writes.push(path);
        return { ok: true };
      },
      editFile: async () => ({ ok: false }),
      deleteFile: async () => ({ ok: false }),
    },
  };
}

const sinks = () => ({ onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn(), onSteerApplied: vi.fn(), onOutcome: vi.fn() });

const base = (transport: ModelTransport, capabilities: CapabilityProvider = workspace()): OnPremRunParams => ({
  prompt: PROMPT,
  cwd: CWD,
  anthropicBaseUrl: "https://gw/llm",
  gatewayAuthKey: "k",
  transport,
  capabilities,
});

describe("runOnPremAgent — conformance", () => {
  it("asks the model the same things, and reaches the same answer, as the agent under another entry point's label", async () => {
    const onPremRequests: ModelRequest[] = [];
    const s = sinks();
    const result = await runOnPremAgent(base(scripted([FINISH, { content: "Hello! Done." }], onPremRequests)), s);

    const directRequests: ModelRequest[] = [];
    const policy: RunPolicy = {
      entryPoint: "vscode",
      toolScope: "ticket",
      role: "code",
      levers: [],
      budgets: {},
      inference: "hybrid",
      verify: "none",
      approvalGates: [],
      delegation: { requested: false, readsBeforeNudge: 6 },
    };
    const direct = await runAgent({
      task: { prompt: PROMPT, dispatch: { source: "manual" }, workspace: { defaultRepo: CWD } },
      policy,
      ports: {
        model: scripted([FINISH, { content: "Hello! Done." }], directRequests),
        capabilities: workspace(),
        store: { load: () => undefined, save: () => undefined },
        events: { emit: () => undefined },
        human: { ask: async () => ({ kind: "paused" }) },
        context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      },
    });

    expect(onPremRequests).toEqual(directRequests);
    if (direct.kind !== "finished") throw new Error(`the direct run did not finish: ${direct.kind}`);
    expect(result).toEqual({ ok: true, text: direct.output });
    const row = (s.onOutcome.mock.calls[0] as [RunOutcomeRow])[0];
    expect(row).toMatchObject({ entryPoint: "on-prem", terminalStatus: "finished" });
    expect(row.parentRunId).toBeUndefined();
  });

  it("refuses a write under a path-scoped block gate without running the tool", async () => {
    const writes: string[] = [];
    const result = await runOnPremAgent(
      {
        ...base(scripted([WRITE_SECRET, { content: "blocked" }]), workspace(writes)),
        policyGates: [{ id: "no-secrets", effect: "block", tool: "write_file", paths: ["secrets/**"], reason: "do not write secrets" }],
      },
      sinks(),
    );
    expect(writes).toEqual([]);
    expect(result).toEqual({ ok: true, text: "blocked" });
  });

  it("delivers the persona in the system row and the task as the first user message", async () => {
    const requests: ModelRequest[] = [];
    await runOnPremAgent({ ...base(scripted([{ content: "ok" }], requests)), appendSystemPrompt: "You are Ada." }, sinks());
    expect(requests[0]?.messages[0]).toEqual({ role: "system", content: "You are Ada." });
    expect(requests[0]?.messages[1]).toEqual({ role: "user", content: PROMPT });
  });

  it("surfaces a steered stop command as cancelled", async () => {
    const steering = createSteeringChannel();
    const transport = scripted([READ, { content: "never" }], [], () => void steering.push("STOP executing"));
    const result = await runOnPremAgent({ ...base(transport), steering }, sinks());
    expect(result).toEqual({ ok: false, text: "cancelled", cancelled: true });
  });

  it("says so when the invocation only yielded", async () => {
    const result = await runOnPremAgent({ ...base(scripted([READ, { content: "done" }])), maxSteps: 1 }, sinks());
    expect(result).toEqual({ ok: true, text: "", yielded: true });
  });

  it("hands back a steer the run never reached, and refuses later ones", async () => {
    const steering = createSteeringChannel();
    const late = vi.fn();
    // The user types while the (failing) turn is in flight; the run ends before it can take it.
    const transport = scripted([new Error("gateway 503")], [], () => void steering.push("one more thing", 11));

    const result = await runOnPremAgent({ ...base(transport), steering, onLateSteers: late }, sinks());

    expect(result.ok).toBe(false);
    expect(late).toHaveBeenCalledWith([{ text: "one more thing", messageId: 11 }]);
    expect(steering.push("too late")).toBe(false);
  });

  it("stamps ONE run id: a sub-agent's row names the row of the owner that spawned it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "onprem-runid-"));
    try {
      const SPAWN: ModelCompletion = { content: "", toolCalls: [{ id: "s1", name: "spawn_agent", arguments: '{"label":"look","task":"where is it?"}' }], model: "fake-model" };
      const s = sinks();
      // The child gets its own sinks from `forChild`; collect its row beside the owner's.
      const rows: RunOutcomeRow[] = [];
      s.onOutcome.mockImplementation((row: RunOutcomeRow) => void rows.push(row));
      const child = { onAssistantText: vi.fn(), onToolUse: vi.fn(), onResult: vi.fn(), onOutcome: (row: RunOutcomeRow) => void rows.push(row) };
      // Owner: spawn → (child answers) → owner finishes.
      const transport = scripted([SPAWN, { content: "found it in a.ts", model: "fake-model" }, { content: "all done", model: "fake-model" }]);
      const result = await runOnPremAgent(
        { prompt: PROMPT, cwd: dir, anthropicBaseUrl: "https://gw/llm", gatewayAuthKey: "k", transport, executionId: 77 },
        { ...s, forChild: () => child },
      );
      expect(result).toMatchObject({ ok: true });
      const owner = rows.find((r) => r.parentRunId === undefined);
      const kid = rows.find((r) => r.parentRunId !== undefined);
      expect(owner?.runId).toBe("77");
      // The child's pointer is the owner's row id — it points at a row that exists…
      expect(kid?.parentRunId).toBe(owner?.runId);
      // …and has an id of its own, so its row can be reported under it.
      expect(kid?.runId).toBeTruthy();
      expect(kid?.runId).not.toBe(owner?.runId);
      // On the wire both ids are namespaced TOGETHER: the child's parent_run_id is the owner's client_run_id.
      const reports = rows.map((r) => buildRunRowReport(r));
      const ownerReport = reports[rows.indexOf(owner!)];
      const kidReport = reports[rows.indexOf(kid!)];
      expect(ownerReport?.clientRunId).toBe("onprem:77");
      expect(kidReport?.parentRunId).toBe(ownerReport?.clientRunId);
      expect(ownerReport?.parentRunId).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not hand back a steer the run took", async () => {
    const steering = createSteeringChannel();
    const late = vi.fn();
    const transport = scripted([{ content: "first pass" }, { content: "steered pass" }], [], (n) => {
      if (n === 0) steering.push("also add tests");
    });

    const result = await runOnPremAgent({ ...base(transport), steering, onLateSteers: late }, sinks());

    expect(result).toEqual({ ok: true, text: "steered pass" });
    expect(late).not.toHaveBeenCalled();
  });
});
