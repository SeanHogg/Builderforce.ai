import { afterEach, describe, expect, it, vi } from "vitest";

/** The run store a child's report is read from, faked per child key. */
const traces = new Map<number, Array<{ category: string; label: string; ts?: string; args?: unknown; result?: unknown }>>();
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  codeChangesOf: () => [],
  getRunSnapshot: () => ({ appended: [{ role: "assistant", content: "All three passed." }], error: "" }),
  getRunTrace: (key: number) => traces.get(key) ?? [],
  isModelReply: (m: { role: string }) => m.role === "assistant",
  queueRunSteering: vi.fn(),
  noteRunStep: vi.fn(),
  // The interrupted-run view reads a journaled checkpoint; these runs journal none.
  parseResumeState: () => undefined,
}));

import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { childControls, ownerFinishHold, startedCommandsOf, type ChildRunHost } from "./childRunSpawner";
import { interruptedResumeTurn } from "./interruptedResumeTurn";
import { MAX_STALLED_HOLDS } from "./liveChildrenFinish";
import { createChildRuns } from "./childRuns";
import { createChildLedger } from "./childLedger";
import { persistChildrenTo } from "./childRunJournal";
import { toInterruptedRunView } from "./interruptedRunsView";
import { recordRunStarted, recoverInterruptedRuns } from "./runRecovery";
import { withChildCommandGuard } from "./subagentCommandGuard";
import type { ToolDef } from "./fileTools";

/** A host whose children run until the test settles them. */
function fakeHost() {
  const finish = new Map<number, () => void>();
  const host: ChildRunHost = {
    registry: createChildRuns(),
    startChild: (key) => new Promise<void>((resolve) => finish.set(key, resolve)),
    stop: () => undefined,
    wake: () => true,
    postDirection: () => undefined,
    changed: () => undefined,
  };
  return { host, finish: async (key: number) => { finish.get(key)!(); await new Promise((r) => setTimeout(r, 0)); } };
}

const OWNER = { key: 7, rootChatId: 7, name: "Ada", depth: 0 };
const VERIFY_BRIEF = "Check the change, then report whether the build is green.\n- pnpm exec tsc --noEmit\n- pnpm vitest run src/a.test.ts";

const shell = (ran: string[]): ToolDef => ({
  name: "run_command",
  description: "",
  parameters: {},
  mutating: true,
  execute: async (args) => { ran.push(String(args.command)); return JSON.stringify({ ok: true }); },
});

afterEach(() => {
  traces.clear();
  vi.useRealTimers();
});

describe("an owner never runs what its live child owns (chat #60338)", () => {
  it("regression: chat #60338 — refuses a parent run_command that duplicates the live child's command, and runs it once the child settled", async () => {
    const { host, finish } = fakeHost();
    const controls = childControls(host, OWNER);
    const spawned = controls.spawn({ label: "verify", task: VERIFY_BRIEF, role: "verify" });
    expect(spawned).toMatchObject({ ok: true, handle: "a1" });
    const ran: string[] = [];
    const [guarded] = withChildCommandGuard([shell(ran)], controls);

    const refused = JSON.parse(await guarded!.execute({ command: "pnpm exec tsc --noEmit 2>&1 | tail -30", background: true }, "/repo"));
    expect(refused).toMatchObject({ ok: false, error: "a1 is already running this — call wait_agents for its result" });
    expect(ran).toEqual([]);

    await finish(host.registry.liveOf(OWNER.key)[0]!.key);
    await guarded!.execute({ command: "pnpm exec tsc --noEmit" }, "/repo");
    expect(ran).toEqual(["pnpm exec tsc --noEmit"]);
  });

  it("refuses a command the live child has already started, though its brief never named it", async () => {
    const { host } = fakeHost();
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "flaky", task: "Investigate why the auth test is flaky and fix it.", role: "code" });
    traces.set(host.registry.liveOf(OWNER.key)[0]!.key, [{ category: "tool", label: "run_command", args: { command: "pnpm vitest run src/auth.test.ts" } }]);
    expect(controls.runningCommand("pnpm vitest run src/auth.test.ts")).toBe("a1 is already running this — call wait_agents for its result");
    expect(controls.runningCommand("pnpm vitest run src/other.test.ts")).toBeNull();
  });

  it("does not refuse the same command in a different directory from where the child started it", async () => {
    const { host } = fakeHost();
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "api", task: "Investigate why the api tests fail and fix them.", role: "code" });
    traces.set(host.registry.liveOf(OWNER.key)[0]!.key, [{ category: "tool", label: "run_command", args: { command: "pnpm test", cwd: "api" } }]);
    expect(controls.runningCommand("pnpm test", "api")).toBe("a1 is already running this — call wait_agents for its result");
    expect(controls.runningCommand("cd api && pnpm test")).not.toBeNull();
    expect(controls.runningCommand("pnpm test", "clients/vscode")).toBeNull();
    expect(controls.runningCommand("pnpm test")).toBeNull();
    // The guard hands the owner's own `cwd` through.
    const ran: string[] = [];
    const [guarded] = withChildCommandGuard([shell(ran)], controls);
    await guarded!.execute({ command: "pnpm test", cwd: "clients/vscode" }, "/repo");
    expect(ran).toEqual(["pnpm test"]);
    expect(JSON.parse(await guarded!.execute({ command: "pnpm test", cwd: "api" }, "/repo"))).toMatchObject({ ok: false, refused: true });
  });

  it("shares the ledger across the owner's controls — a wake builds new controls for the same run", () => {
    const { host } = fakeHost();
    childControls(host, OWNER).spawn({ label: "verify", task: VERIFY_BRIEF, role: "verify" });
    expect(childControls(host, OWNER).runningCommand("pnpm vitest run src/a.test.ts")).not.toBeNull();
    // Another owner's children are not this owner's to wait for.
    expect(childControls(host, { ...OWNER, key: 8 }).runningCommand("pnpm vitest run src/a.test.ts")).toBeNull();
  });
});

describe("a host's child ledger persists with the parent run (chat #61651)", () => {
  it("a child spawned through the controls is on the parent's journal record, and the resume view tells of it", async () => {
    const store = createMemoryLocalFirstStore();
    const journal = { deviceId: "device-1", now: () => new Date("2026-11-08T10:00:00Z") };
    await recordRunStarted(store, journal, { runId: "run-7", chatId: String(OWNER.rootChatId) });
    // The host's wiring (`brainRunHostPorts.ts`), with each best-effort write captured so the test can await it.
    const logs: string[] = [];
    const { host } = fakeHost();
    const ledger = createChildLedger({
      startedCommands: startedCommandsOf,
      persist: persistChildrenTo(store, journal.now),
      log: (line) => void logs.push(line),
    });
    host.ledger = ledger;

    childControls(host, OWNER).spawn({ label: "verify", task: VERIFY_BRIEF, role: "verify" });
    await ledger.flush();

    const [run] = await recoverInterruptedRuns(store, journal);
    const view = toInterruptedRunView(run!);
    expect(view.chatId).toBe("7");
    const told = interruptedResumeTurn((_k, fallback) => fallback, view.resume);
    expect(told).toContain("a1 (verify; started by Ada): interrupted — not resumed");
    expect(told).toContain("pnpm exec tsc --noEmit");
    expect(logs).toEqual([]);
  });
});

describe("the owner's finish hold always has an exit", () => {
  it("regression: chat #61651 — an owner cannot end with a live, working child (no empty-ask wake run follows)", async () => {
    const { host } = fakeHost();
    childControls(host, OWNER).spawn({ label: "audit", task: "Audit it.", role: "review" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    const hold = ownerFinishHold(host, OWNER.key);
    // The child keeps making progress: every finish attempt is held, however many.
    for (let step = 0; step < 6; step += 1) {
      traces.set(key, Array.from({ length: step + 1 }, (_, i) => ({ category: "tool", label: "read_file", ts: `t${i}` })));
      expect(await hold()).toContain("a1");
    }
  });

  it("a stop-requested child does not hold the finish, and its late report does not wake the owner", async () => {
    const { host, finish } = fakeHost();
    const wake = vi.fn(() => true);
    host.wake = wake;
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "audit", task: "Audit it.", role: "review" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    controls.stop(["a1"]);
    expect(await ownerFinishHold(host, OWNER.key)()).toBeNull();
    await finish(key);
    expect(wake).not.toHaveBeenCalled();
  });

  it("a hung child is stopped after the stalled-hold cap and the owner finishes", async () => {
    const { host } = fakeHost();
    const stopped: number[] = [];
    host.stop = (k) => void stopped.push(k);
    childControls(host, OWNER).spawn({ label: "audit", task: "Audit it.", role: "review" });
    const key = host.registry.liveOf(OWNER.key)[0]!.key;
    const hold = ownerFinishHold(host, OWNER.key);
    for (let i = 0; i < MAX_STALLED_HOLDS; i += 1) expect(await hold()).not.toBeNull();
    expect(await hold()).toBeNull();
    expect(stopped).toEqual([key]);
    expect(host.registry.stopRequested(key)).toBe(true);
  });
});

describe("wait_agents returns when its children finish, not at the timeout", () => {
  it("resolves the moment the awaited child settles, with no timer advanced", async () => {
    vi.useFakeTimers();
    const { host } = fakeHost();
    const controls = childControls(host, OWNER);
    controls.spawn({ label: "verify", task: VERIFY_BRIEF, role: "verify" });
    let done = false;
    const waiting = controls.wait([], 300_000).then((out) => { done = true; return out; });
    await Promise.resolve();
    expect(done).toBe(false);

    host.registry.settle(host.registry.liveOf(OWNER.key)[0]!.key, { handle: "a1", name: "verify", label: "verify", state: "done", output: "green" });
    await vi.advanceTimersByTimeAsync(0); // flush microtasks only — the 300 s timer never fires
    expect(done).toBe(true);
    await expect(waiting).resolves.toMatchObject({ reports: [{ handle: "a1", output: "green" }], running: [] });
  });
});
