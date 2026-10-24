import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";
import { emitAgentEvent } from "./agent-events.js";
import {
  buildKnowledgeMemoryEntry,
  deriveActivitySummary,
  KnowledgeLoopService,
} from "./knowledge-loop.js";
import type { OnPremVerifyEvent } from "./run-outcome-memory.js";

describe("deriveActivitySummary", () => {
  it("returns empty string when no activity", () => {
    expect(deriveActivitySummary({ created: [], edited: [], tools: [] })).toBe("");
  });

  it("identifies multi-agent workflow execution", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["orchestrate"],
    });
    expect(result).toBe("Multi-agent workflow execution");
  });

  it("identifies code review / analysis", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["git_history", "view"],
    });
    expect(result).toBe("Code review / analysis");
  });

  it("identifies test suite creation", () => {
    const result = deriveActivitySummary({
      created: ["src/foo.test.ts"],
      edited: [],
      tools: ["create", "bash"],
    });
    expect(result).toBe("Test suite created");
  });

  it("identifies test updates", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: ["src/bar.test.ts"],
      tools: ["edit"],
    });
    expect(result).toBe("Tests updated");
  });

  it("identifies read-only codebase analysis", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["grep", "glob", "view"],
    });
    expect(result).toBe("Codebase exploration / read-only analysis");
  });

  it("identifies feature implementation with new files and edits", () => {
    const result = deriveActivitySummary({
      created: ["src/feature.ts"],
      edited: ["src/index.ts"],
      tools: ["create", "edit"],
    });
    expect(result).toBe("Feature implementation: new files + edits");
  });

  it("identifies new file creation only", () => {
    const result = deriveActivitySummary({
      created: ["src/a.ts", "src/b.ts"],
      edited: [],
      tools: ["create"],
    });
    expect(result).toBe("New file(s) created: 2");
  });

  it("identifies code modifications only", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: ["src/a.ts", "src/b.ts", "src/c.ts"],
      tools: ["edit"],
    });
    expect(result).toBe("Code modifications: 3 file(s) changed");
  });

  it("identifies agent activity with no file changes", () => {
    const result = deriveActivitySummary({
      created: [],
      edited: [],
      tools: ["bash"],
    });
    expect(result).toBe("Agent activity (no file changes)");
  });

  it("orchestration takes priority over everything else", () => {
    const result = deriveActivitySummary({
      created: ["src/foo.ts"],
      edited: ["src/bar.ts"],
      tools: ["create", "edit", "orchestrate", "git_history"],
    });
    expect(result).toBe("Multi-agent workflow execution");
  });
});

describe("buildKnowledgeMemoryEntry", () => {
  it("skips empty heading-only entries", () => {
    expect(
      buildKnowledgeMemoryEntry({
        sessionKey: "agent:main:main",
        ts: "2026-03-14T00:04:29.680Z",
      }),
    ).toBeNull();
  });

  it("persists entries when there is meaningful activity", () => {
    const entry = buildKnowledgeMemoryEntry({
      sessionKey: "agent:main:main",
      ts: "2026-03-14T00:04:29.680Z",
      acc: {
        sessionKey: "agent:main:main",
        knowledge: (() => {
          const r = new RunKnowledgeRecorder();
          r.record("edit", { path: "src/app.ts" });
          return r;
        })(),
      },
    });

    expect(entry).toContain("**Edited**: src/app.ts");
    expect(entry).toContain("**Summary**: Code modifications: 1 file(s) changed");
  });
});

describe("on-prem finish path records verify without a shell", () => {
  const dirs: string[] = [];
  const services: KnowledgeLoopService[] = [];

  afterEach(async () => {
    for (const svc of services.splice(0)) {
      svc.stop();
    }
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function started(verifyRecorder: (event: OnPremVerifyEvent) => void) {
    const workspaceDir = await mkdtemp(join(tmpdir(), "bf-verify-"));
    dirs.push(workspaceDir);
    const svc = new KnowledgeLoopService({ workspaceDir, verifyRecorder });
    services.push(svc);
    svc.start();
    return svc;
  }

  it("records a check the tool loop already ran, and does not emit verify_started for a run with no check", async () => {
    const events: OnPremVerifyEvent[] = [];
    await started((event) => events.push(event));

    emitAgentEvent({
      runId: "no-check",
      stream: "tool",
      data: { phase: "result", name: "read_file", toolCallId: "r1", isError: false, result: { ok: true } },
    });
    emitAgentEvent({ runId: "no-check", stream: "lifecycle", data: { phase: "end" } });

    emitAgentEvent({
      runId: "checked",
      stream: "tool",
      data: { phase: "start", name: "run_command", toolCallId: "c1", args: { command: "npm test" } },
    });
    emitAgentEvent({
      runId: "checked",
      stream: "tool",
      data: {
        phase: "result",
        name: "run_command",
        toolCallId: "c1",
        isError: false,
        result: { exitCode: 0, stdout: "ok" },
      },
    });
    emitAgentEvent({ runId: "checked", stream: "lifecycle", data: { phase: "end" } });

    const startedEvents = events.filter((e) => "type" in e && e.type === "verify_started");
    expect(startedEvents).toHaveLength(1);
    const timeline = events.find((e) => !("type" in e));
    expect(timeline).toMatchObject({
      toolName: "in_run_verify",
      category: "tool",
      result: expect.stringContaining("verify passed: npm test (exit 0)"),
    });
    expect(JSON.stringify(events)).not.toContain("verify_completed");
  });

  it("records each call once, on its result, and never a call that failed", async () => {
    await started(() => undefined);
    const dir = dirs[dirs.length - 1]!;
    const call = (id: string, name: string, path: string, isError: boolean) => {
      emitAgentEvent({ runId: "rec", stream: "tool", data: { phase: "start", name, toolCallId: id, args: { path } } });
      emitAgentEvent({ runId: "rec", stream: "tool", data: { phase: "result", name, toolCallId: id, isError } });
    };
    call("w1", "edit", "src/ok.ts", false);
    call("w2", "edit", "src/bad.ts", true);
    call("r1", "read_file", "src/seen.ts", false);
    emitAgentEvent({ runId: "rec", stream: "lifecycle", data: { phase: "end" } });

    const memDir = join(dir, ".builderforce", "memory");
    let text = "";
    for (let i = 0; i < 50 && !text; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const files = await readdir(memDir).catch(() => [] as string[]);
      if (files[0]) text = await readFile(join(memDir, files[0]), "utf-8");
    }
    expect(text).toContain("**Edited**: src/ok.ts");
    expect(text).toContain("**Read**: src/seen.ts");
    expect(text).not.toContain("src/bad.ts");
  });

  it("a thrown recorder does not fail the finished run", async () => {
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => {
      rejections.push(err);
    };
    process.on("unhandledRejection", onRejection);
    let calls = 0;
    try {
      await started(() => {
        calls += 1;
        throw new Error("recorder down");
      });
      emitAgentEvent({
        runId: "throws",
        stream: "tool",
        data: {
          phase: "result",
          name: "run_checks",
          isError: false,
          result: { ok: true, ran: true },
        },
      });
      emitAgentEvent({ runId: "throws", stream: "lifecycle", data: { phase: "end" } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBeGreaterThan(0);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
