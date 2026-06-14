/**
 * On-prem (self-hosted) agent telemetry / log population.
 *
 * Every orchestrated task execution on a hosted agent must leave a durable,
 * queryable trail. WorkflowTelemetryService is the seam that does it, three ways
 * at once per span:
 *   • a local JSONL audit file  (.builderForceAgents/telemetry/YYYY-MM-DD.jsonl)
 *   • an HTTP sync to Builderforce.ai (workflow + task REST + the OTel span proxy)
 *   • a live relay hook            (WebSocket frames to browser clients)
 *
 * If any of those silently stops firing, an on-prem run becomes invisible on the
 * Observability timeline and absent from the cost rollup — with nothing failing.
 * These tests drive the real emitters against a temp workspace + a mocked fetch +
 * a captured relay hook and assert all three sinks are populated with the right
 * span shape, trace id, and token/cost metrics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowTelemetryService, type WorkflowSpan } from "./workflow-telemetry.js";

let projectRoot: string;
let fetchMock: ReturnType<typeof vi.fn>;

/** Read back every span the service appended to today's JSONL audit file. */
async function readSpans(): Promise<WorkflowSpan[]> {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(projectRoot, ".builderForceAgents", "telemetry", `${date}.jsonl`);
  const text = await fs.readFile(file, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WorkflowSpan);
}

/** Wait until the async JSONL append (fired via `void appendSpan`) has flushed. */
async function spansSettle(expected: number): Promise<WorkflowSpan[]> {
  return vi.waitFor(async () => {
    const spans = await readSpans();
    if (spans.length < expected) throw new Error(`have ${spans.length}/${expected} spans`);
    return spans;
  });
}

function urlsFetched(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bf-telemetry-"));
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("WorkflowTelemetryService — local JSONL audit trail", () => {
  it("writes a workflow.start span with a fresh W3C trace id to the day's JSONL file", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });

    svc.emitWorkflowStart("wf-1", "build the thing");

    const [span] = await spansSettle(1);
    expect(span).toMatchObject({
      kind: "workflow.start",
      workflowId: "wf-1",
      description: "build the thing",
    });
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/); // 16-byte W3C trace id
    expect(svc.getActiveTraceId()).toBe(span.traceId);
  });

  it("records a full task lifecycle (start → complete) with token + cost metrics", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });
    svc.emitWorkflowStart("wf-1");

    const startedAt = new Date(Date.now() - 1234);
    svc.emitTaskStart("wf-1", "t-1", "coder", "edit files");
    svc.emitTaskEnd("wf-1", "t-1", "coder", startedAt, undefined, {
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 250,
      estimatedCostUsd: 0.0123,
    });

    const spans = await spansSettle(3);
    const start = spans.find((s) => s.kind === "task.start")!;
    const done = spans.find((s) => s.kind === "task.complete")!;

    expect(start).toMatchObject({ workflowId: "wf-1", taskId: "t-1", agentRole: "coder", description: "edit files" });
    expect(done).toMatchObject({
      kind: "task.complete",
      taskId: "t-1",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 250,
      estimatedCostUsd: 0.0123,
    });
    expect(done.durationMs).toBeGreaterThanOrEqual(1000); // measured from startedAt
    // every span in the workflow shares the one trace id.
    expect(start.traceId).toBe(svc.getActiveTraceId());
    expect(done.traceId).toBe(start.traceId);
  });

  it("marks a failed task as task.fail and carries the error message", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });
    svc.emitWorkflowStart("wf-1");

    svc.emitTaskEnd("wf-1", "t-2", "coder", new Date(), "boom: tool crashed");

    const spans = await spansSettle(2);
    const fail = spans.find((s) => s.kind === "task.fail")!;
    expect(fail).toMatchObject({ kind: "task.fail", taskId: "t-2", error: "boom: tool crashed" });
  });

  it("clears the active trace id when the workflow ends", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });
    svc.emitWorkflowStart("wf-1");
    expect(svc.getActiveTraceId()).not.toBeNull();

    svc.emitWorkflowEnd("wf-1", false);
    expect(svc.getActiveTraceId()).toBeNull();
  });

  it("is inert before init (no projectRoot ⇒ no writes, no throw)", async () => {
    const svc = new WorkflowTelemetryService();
    expect(() => svc.emitWorkflowStart("wf-x")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WorkflowTelemetryService — Builderforce HTTP sync", () => {
  it("syncs spans to the workflow + task REST endpoints and the OTel span proxy", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot, agentNodeId: "7", linkApiUrl: "https://bf.test/", linkApiKey: "secret" });

    svc.emitWorkflowStart("wf-1", "desc");
    svc.emitTaskStart("wf-1", "t-1", "coder", "do it");
    svc.emitTaskEnd("wf-1", "t-1", "coder", new Date(), undefined, { model: "m", inputTokens: 1, outputTokens: 2 });
    await spansSettle(3);

    const urls = urlsFetched();
    // workflow upsert, task create, task patch — plus an OTel span POST per span.
    expect(urls).toContain("https://bf.test/api/workflows");
    expect(urls).toContain("https://bf.test/api/workflows/wf-1/tasks");
    expect(urls).toContain("https://bf.test/api/workflows/wf-1/tasks/t-1");
    expect(urls.filter((u) => u.startsWith("https://bf.test/api/telemetry/spans?agentNodeId=7"))).toHaveLength(3);

    // The task.complete sync is a PATCH carrying the terminal status.
    const patch = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "https://bf.test/api/workflows/wf-1/tasks/t-1",
    )!;
    expect((patch[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toMatchObject({ status: "completed" });

    // Every synced request is authed + host-tagged + trace-correlated.
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers["X-AgentHost-Id"]).toBe("7");
    expect(headers["X-Trace-Id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not sync when no API link is configured (local-only host)", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot, agentNodeId: "7" }); // no linkApiUrl/linkApiKey
    svc.emitWorkflowStart("wf-1");
    await spansSettle(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WorkflowTelemetryService — live relay hook", () => {
  it("forwards each span to the relay as a browser-facing event", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });
    const relay = vi.fn();
    svc.setRelayHook(relay);

    svc.emitWorkflowStart("wf-1");
    svc.emitTaskStart("wf-1", "t-1", "coder", "do it");
    svc.emitTaskEnd("wf-1", "t-1", "coder", new Date());
    await spansSettle(3);

    const events = relay.mock.calls.map((c) => c[0]);
    expect(events).toEqual(["workflow.update", "task.started", "task.completed"]);
    // payload is the full span (so the browser can render role/tokens/etc).
    expect(relay.mock.calls[1]![1]).toMatchObject({ kind: "task.start", taskId: "t-1" });
  });

  it("a throwing relay hook never blocks the JSONL write", async () => {
    const svc = new WorkflowTelemetryService();
    svc.init({ projectRoot });
    svc.setRelayHook(() => { throw new Error("relay down"); });

    svc.emitWorkflowStart("wf-1");

    const [span] = await spansSettle(1); // file still written despite the throw
    expect(span.kind).toBe("workflow.start");
  });
});
