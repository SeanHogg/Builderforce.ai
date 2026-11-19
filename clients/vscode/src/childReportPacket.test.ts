import { afterEach, describe, expect, it, vi } from "vitest";

/** Each child key's final reply and trace, as the run store would hold them. */
const answers = new Map<number, string>();
const traces = new Map<number, Array<{ category: string; label: string; args?: unknown; result?: unknown }>>();
const notes: Array<{ key: number; label: string }> = [];
/** Child keys whose trace read throws — a report that cannot be built. */
const throwingTrace = new Set<number>();
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  codeChangesOf: () => [],
  getRunSnapshot: (key: number) => ({ appended: [{ role: "assistant", content: answers.get(key) ?? "" }], error: "" }),
  getRunTrace: (key: number) => {
    if (throwingTrace.has(key)) throw new Error("trace store unavailable");
    return traces.get(key) ?? [];
  },
  isModelReply: (m: { role: string }) => m.role === "assistant",
  queueRunSteering: vi.fn(),
  noteRunStep: (key: number, step: { label: string }) => notes.push({ key, label: step.label }),
  parseResumeState: () => undefined,
}));

import { childReportText, SUBAGENT_REPORT_CHARS } from "@builderforce/agent-tools";
import { childControls, type ChildRunHost } from "./childRunSpawner";
import { createChildRuns } from "./childRuns";
import { REPORT_NOW_STEER } from "./childDoneEvidence";

/** VS Code chat #273's child's final reply. */
const CHAT_273_FINAL =
  "I have enough to produce the report. Two named-epic lookups are cheap …\n```ask-user\n{\"question\":\"I've completed the bulk read …\"}\n```";
const REPORT = "Ready tickets cover ROADMAP §1-§3; §4 has none.\n\nOutcome: done\nChanged: none\nChecked: backlog offsets 0-1100\nOpen issues: none";

const OWNER = { key: 7, rootChatId: 7, name: "Ada", depth: 0 };

function fakeHost(over: Partial<ChildRunHost> = {}) {
  const finish = new Map<number, () => void>();
  const host: ChildRunHost = {
    registry: createChildRuns(),
    startChild: (key) => new Promise<void>((resolve) => finish.set(key, resolve)),
    stop: () => undefined,
    wake: () => true,
    postDirection: () => undefined,
    changed: () => undefined,
    ...over,
  };
  return { host, finish: async (key: number) => { finish.get(key)!(); await new Promise((r) => setTimeout(r, 0)); } };
}

afterEach(() => {
  answers.clear();
  traces.clear();
  throwingTrace.clear();
  notes.length = 0;
});

describe("a child's report packet (VS Code chat #273)", () => {
  it("regression: a child that ended on an ask-user block gets ONE report-now turn, and its report is what the owner receives", async () => {
    const resumeChild = vi.fn(async (key: number, _text: string) => { answers.set(key, REPORT); });
    const { host, finish } = fakeHost({ resumeChild });
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "bulk read", task: "Bulk-read open tickets vs roadmap", role: "review" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, CHAT_273_FINAL);
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    expect(resumeChild).toHaveBeenCalledTimes(1);
    expect(resumeChild).toHaveBeenCalledWith(key, REPORT_NOW_STEER);
    const { reports } = await waiting;
    expect(reports[0]).toMatchObject({ state: "done", output: REPORT });
  });

  it("settles a child that STILL does not report after the extra turn as not done — and gives it only one", async () => {
    const resumeChild = vi.fn(async () => undefined);
    const { host, finish } = fakeHost({ resumeChild });
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "bulk read", task: "Bulk-read open tickets vs roadmap", role: "review" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, CHAT_273_FINAL);
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    expect(resumeChild).toHaveBeenCalledTimes(1);
    const { reports } = await waiting;
    expect(reports[0]!.state).toBe("failed");
    expect(reports[0]!.output).toContain("not done: it ended by asking the user");
  });

  it("carries the child's coverage and the path of the data it collected", async () => {
    const saved: Array<{ rootChatId: number; handle: string; text: string }> = [];
    const saveChildData = vi.fn(async (rootChatId: number, handle: string, text: string) => {
      saved.push({ rootChatId, handle, text });
      return `.builderforce/cache/subagents/chat${rootChatId}-${handle}.md`;
    });
    const { host, finish } = fakeHost({ saveChildData });
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "bulk read", task: "Bulk-read open tickets", role: "explore" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, REPORT);
    traces.set(key, [
      { category: "tool", label: "read_file", args: { path: "ROADMAP.md", limit: 400 }, result: { ok: true, offset: 1, content: "x\ny", totalLines: 2 } },
      { category: "tool", label: "builtin_tasks_list", args: { status: "backlog", offset: 300, limit: 50 }, result: { ok: true, tasks: [{ id: 301 }] } },
    ]);
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    const { reports } = await waiting;
    const report = reports[0]!;
    expect(report.coverage).toEqual([
      "read_file ROADMAP.md lines 1-2 of 2",
      'builtin_tasks_list {"limit":50,"offset":300,"status":"backlog"}',
    ]);
    expect(report.dataFile).toBe(".builderforce/cache/subagents/chat7-a1.md");
    expect(saved[0]!.text).toContain('"id": 301');
    const text = childReportText(report);
    expect(text).toContain("Coverage");
    expect(text).toContain("builtin_tasks_list");
    expect(text).toContain(".builderforce/cache/subagents/chat7-a1.md");
  });

  it("ALWAYS settles: a report that throws while being built settles as failed, so wait_agents never hangs", async () => {
    const { host, finish } = fakeHost();
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "x", task: "read things", role: "explore" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, REPORT);
    throwingTrace.add(key);
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    const { reports, running } = await waiting;
    expect(running).toEqual([]);
    expect(reports[0]).toMatchObject({ handle: "a1", state: "failed" });
    expect(reports[0]!.output).toContain("trace store unavailable");
    expect(host.registry.liveOf(OWNER.key)).toEqual([]);
    expect(notes).toContainEqual({ key, label: "run.child_report_failed" });
  });

  it("keeps the answer, coverage and data note inside ONE report budget", async () => {
    const { host, finish } = fakeHost({ saveChildData: async () => ".builderforce/cache/subagents/chat7-a1.md" });
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "x", task: "read things", role: "explore" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, `${"finding ".repeat(2_000)}\n\nOutcome: done`);
    traces.set(key, Array.from({ length: 80 }, (_, i) => ({ category: "tool", label: "builtin_tasks_list", args: { status: "backlog", offset: i * 50 }, result: { ok: true } })));
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    const report = (await waiting).reports[0]!;
    const text = childReportText(report);
    const head = text.indexOf("\n\n") + 2;
    expect(text.length - head).toBeLessThanOrEqual(SUBAGENT_REPORT_CHARS + 200);
    expect(report.coverage!.at(-1)).toMatch(/more \(every call is in the collected-data file\)/);
  });

  it("reports a failed save on the child's trace instead of dropping it, and still settles", async () => {
    const { host, finish } = fakeHost({ saveChildData: async () => { throw new Error("EACCES"); } });
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "x", task: "read things", role: "explore" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    answers.set(key, REPORT);
    traces.set(key, [{ category: "tool", label: "builtin_tasks_list", args: {}, result: { ok: true } }]);
    const waiting = controls.wait(["a1"], 1_000);
    await finish(key);
    const { reports } = await waiting;
    expect(reports[0]!.dataFile).toBeUndefined();
    expect(notes).toContainEqual({ key, label: "run.child_data_unsaved" });
  });
});
