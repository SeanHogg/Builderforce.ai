import { describe, expect, it, vi } from "vitest";
import type { Run, Skill } from "@seanhogg/builderforce-memory-engine";
import { createSkillRunner, resolveRunValues } from "./skillRunner";
import { APPROVAL_TIMEOUT_MS, type RunnerMessages, type SkillRunnerPorts } from "./skillRunnerPorts";
import type { HelperEvent } from "./teachHelperProtocol";
import type { PhoneApprovalRelay } from "./phoneApprovalRelay";

const target = { name: "Send", automationId: "send", controlType: "Button", className: "", windowTitle: "", processName: "", relX: 0, relY: 0 };

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "Invoice",
    program: "app.exe",
    args: [],
    params: [
      { name: "amount", label: "Amount", default: "1", secret: false },
      { name: "pin", label: "PIN", default: null, secret: true },
    ],
    steps: [
      { id: "st0", action: { kind: "click", target }, requiresApproval: true },
      { id: "st1", action: { kind: "keys", keys: "{ENTER}" }, requiresApproval: false },
    ],
    sourceEpisode: "e1",
    createdAt: 1,
    routine: null,
    ...over,
  };
}

const messages: RunnerMessages = {
  orphaned: "Synapse closed during the run",
  unsupported: "unsupported",
  busy: "busy",
  lockedElsewhere: "locked elsewhere",
  stopped: "stopped before start",
  explain: (e) => (e instanceof Error ? e.message : String(e)),
  unknownSkill: (id) => `no skill ${id}`,
  approvalDescription: (s, n, a) => `${s} #${n}: ${a}`,
  lastRun: (s, status, at, trigger) => `${s} ${status} ${at} ${trigger}`,
};

function setup(opts: { skill?: Skill; relayAnswer?: (signal: AbortSignal) => Promise<boolean | undefined>; secrets?: Record<string, string>; runs?: Run[] } = {}) {
  const sk = opts.skill ?? skill();
  let listener: (e: HelperEvent) => void = () => undefined;
  const helper = {
    probe: vi.fn(async () => ({ supported: true })),
    recordStart: vi.fn(),
    recordStop: vi.fn(),
    runStart: vi.fn(async () => undefined),
    runStop: vi.fn(async () => undefined),
    approveAnswer: vi.fn(async () => undefined),
    onEvent: vi.fn((l: (e: HelperEvent) => void) => {
      listener = l;
      return { dispose: vi.fn() };
    }),
    dispose: vi.fn(),
  };
  const calls: string[] = [];
  const store = {
    getSkill: vi.fn(async (id: string) => (id === sk.id ? sk : undefined)),
    startRun: vi.fn(async (_id: string, trigger: string) => {
      calls.push(`startRun:${trigger}`);
      return { id: "run1", skillId: sk.id, skillName: sk.name, trigger, status: "running", startedAt: 0, steps: [] } as Run;
    }),
    stepRun: vi.fn(async (i: { idx: number; outcome: string }) => void calls.push(`stepRun:${i.idx}:${i.outcome}`)),
    finishRun: vi.fn(async (id: string, status: string) => void calls.push(`finishRun:${id}:${status}`)),
    listRuns: vi.fn(async () => opts.runs ?? []),
  };
  const kept = { ...(opts.secrets ?? {}) };
  const secrets = {
    get: vi.fn(async (_s: string, p: string) => kept[p]),
    set: vi.fn(async (_s: string, p: string, v: string) => void (kept[p] = v)),
    clear: vi.fn(),
  };
  const relay: PhoneApprovalRelay & { open: ReturnType<typeof vi.fn>; answer: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
    open: vi.fn(async () => "ap1"),
    answer: vi.fn((_id: string, signal: AbortSignal) =>
      opts.relayAnswer
        ? opts.relayAnswer(signal)
        : new Promise<boolean | undefined>((resolve) => signal.addEventListener("abort", () => resolve(undefined))),
    ),
    close: vi.fn(async () => undefined),
  };
  let fireTimeout: () => void = () => undefined;
  const clock = {
    now: () => Date.UTC(2026, 0, 1),
    setTimeout: vi.fn((fn: () => void) => {
      fireTimeout = fn;
      return 1;
    }),
    clearTimeout: vi.fn(),
  };
  const remember = vi.fn(async () => undefined);
  const report = vi.fn();
  const lockState = { acquire: true, other: false };
  const lock = {
    acquire: vi.fn(async () => lockState.acquire),
    release: vi.fn(async () => undefined),
    heldByOther: vi.fn(async () => lockState.other),
  };
  const ports: SkillRunnerPorts = { helper, store, secrets, relay, lock, clock, messages, remember, report };
  const runner = createSkillRunner(ports);
  return { runner, helper, store, secrets, relay, lock, lockState, clock, remember, report, calls, emit: (e: HelperEvent) => listener(e), fire: () => fireTimeout(), sk };
}

describe("resolveRunValues", () => {
  it("takes what was given first, then the routine's values, then the keychain for unset secrets", async () => {
    const sk = skill({ routine: { schedule: { every: "minutes", minutes: 5 }, values: { amount: "routine" }, enabled: true } });
    const secrets = { get: vi.fn(async () => "kept"), set: vi.fn(), clear: vi.fn() };
    expect(await resolveRunValues(sk, {}, secrets)).toEqual({ amount: "routine", pin: "kept" });
    expect(await resolveRunValues(sk, { amount: "given", pin: "typed" }, secrets)).toEqual({ amount: "given", pin: "typed" });
  });

  it("leaves out a secret nobody has, so the helper can refuse before anything moves", async () => {
    const secrets = { get: vi.fn(async () => undefined), set: vi.fn(), clear: vi.fn() };
    expect(await resolveRunValues(skill(), { amount: "5" }, secrets)).toEqual({ amount: "5" });
  });
});

describe("skillRunner audit trail", () => {
  it("writes startRun, a stepRun per step event, finishRun, then the last-run fact", async () => {
    const t = setup({ secrets: { pin: "kept" } });
    const started = await t.runner.start({ skillId: "s1", trigger: "routine", values: { amount: "9" } });
    expect(started.ok).toBe(true);
    expect(t.helper.runStart).toHaveBeenCalledWith("run1", t.sk, { amount: "9", pin: "kept" });
    t.emit({ event: "run.stepStarted", runId: "run1", idx: 0 });
    t.emit({ event: "run.stepFinished", runId: "run1", idx: 0, outcome: "ok" });
    t.emit({ event: "run.stepFinished", runId: "run1", idx: 1, outcome: "fallback", detail: "by position" });
    t.emit({ event: "run.finished", runId: "run1", status: "succeeded" });
    if (started.ok) await started.done;
    expect(t.calls).toEqual(["startRun:routine", "stepRun:0:ok", "stepRun:1:fallback", "finishRun:run1:succeeded"]);
    expect(t.store.stepRun).toHaveBeenCalledWith(expect.objectContaining({ stepId: "st1", detail: "by position" }));
    expect(t.remember).toHaveBeenCalledWith({
      key: "synapse.skill.s1.last-run",
      content: "Invoice succeeded 2026-01-01T00:00:00.000Z routine",
      tags: ["synapse", "skill-run"],
    });
    expect(t.runner.active).toBe(false);
  });

  it("keeps a typed secret only when asked to remember it", async () => {
    const t = setup();
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { amount: "1", pin: "1234" }, remember: ["pin"] });
    expect(t.secrets.set).toHaveBeenCalledWith("s1", "pin", "1234");
  });

  it("records a refused start as a failed run and reports why", async () => {
    const t = setup();
    t.helper.runStart.mockRejectedValueOnce(new Error("missing value: pin"));
    const r = await t.runner.start({ skillId: "s1", trigger: "manual" });
    expect(r).toEqual({ ok: false, error: "missing value: pin" });
    expect(t.calls).toEqual(["startRun:manual", "finishRun:run1:failed"]);
    expect(t.runner.active).toBe(false);
  });

  it("runs one at a time", async () => {
    const t = setup();
    await t.runner.start({ skillId: "s1", trigger: "manual" });
    expect(await t.runner.start({ skillId: "s1", trigger: "manual" })).toEqual({ ok: false, error: "busy" });
  });

  it("will not start where the helper is unsupported", async () => {
    const t = setup();
    t.helper.probe.mockResolvedValueOnce({ supported: false });
    expect(await t.runner.start({ skillId: "s1", trigger: "manual" })).toEqual({ ok: false, error: "unsupported" });
    expect(t.store.startRun).not.toHaveBeenCalled();
  });
});

describe("skillRunner approvals", () => {
  async function atGate(t: ReturnType<typeof setup>) {
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", runId: "run1", idx: 0 });
    await vi.waitFor(() => expect(t.relay.answer).toHaveBeenCalled());
  }

  it("the in-window answer wins and the phone's copy is closed", async () => {
    const t = setup();
    await atGate(t);
    t.runner.answerApproval("run1", 0, true);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, true));
    expect(t.relay.close).toHaveBeenCalledWith("ap1", true);
    expect((t.relay.answer.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    expect(t.relay.open).toHaveBeenCalledWith(expect.objectContaining({ runId: "run1", skill: "Invoice", step: 1, action: "click Send", description: "Invoice #1: click Send" }));
  });

  it("the phone wins when it answers first, and is not PATCHed again", async () => {
    const t = setup({ relayAnswer: async () => true });
    await atGate(t);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, true));
    expect(t.relay.close).not.toHaveBeenCalled();
  });

  it("a phone refusal is a no", async () => {
    const t = setup({ relayAnswer: async () => false });
    await atGate(t);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, false));
  });

  it("a 15 minute timeout is a no", async () => {
    const t = setup();
    await atGate(t);
    expect(t.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), APPROVAL_TIMEOUT_MS);
    t.fire();
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, false));
    expect(t.relay.close).toHaveBeenCalledWith("ap1", false);
  });

  it("Stop is a no, and stops the helper", async () => {
    const t = setup();
    await atGate(t);
    await t.runner.stop();
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, false));
    expect(t.helper.runStop).toHaveBeenCalled();
    expect(t.relay.close).toHaveBeenCalledWith("ap1", false);
  });

  it("works with no phone relay (signed out): only the window can answer", async () => {
    const t = setup();
    t.relay.open.mockResolvedValueOnce(undefined);
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", runId: "run1", idx: 0 });
    await vi.waitFor(() => expect(t.clock.setTimeout).toHaveBeenCalled());
    t.runner.answerApproval("run1", 0, false);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith("run1", 0, false));
    expect(t.relay.answer).not.toHaveBeenCalled();
    expect(t.relay.close).not.toHaveBeenCalled();
  });
});

describe("skillRunner.recoverOrphans", () => {
  it("marks runs left `running` as failed with the localized reason, and nothing else", async () => {
    const mk = (id: string, status: Run["status"]) => ({ id, skillId: "s1", skillName: "Invoice", trigger: "manual", status, startedAt: 0, steps: [] }) as Run;
    const t = setup({ runs: [mk("a", "running"), mk("b", "succeeded"), mk("c", "running")] });
    expect(await t.runner.recoverOrphans()).toBe(2);
    expect(t.store.finishRun).toHaveBeenCalledWith("a", "failed", "Synapse closed during the run");
    expect(t.store.finishRun).toHaveBeenCalledWith("c", "failed", "Synapse closed during the run");
    expect(t.store.finishRun).toHaveBeenCalledTimes(2);
  });

  it("leaves `running` runs alone while another window holds the lock: they are live", async () => {
    const mk = (id: string) => ({ id, skillId: "s1", skillName: "Invoice", trigger: "manual", status: "running", startedAt: 0, steps: [] }) as Run;
    const t = setup({ runs: [mk("a")] });
    t.lockState.other = true;
    expect(await t.runner.recoverOrphans()).toBe(0);
    expect(t.store.finishRun).not.toHaveBeenCalled();
  });
});

describe("skillRunner machine-wide lock", () => {
  it("refuses to start while another window holds the lock, writing no run", async () => {
    const t = setup();
    t.lockState.acquire = false;
    expect(await t.runner.start({ skillId: "s1", trigger: "manual" })).toEqual({ ok: false, error: "locked elsewhere" });
    expect(t.store.startRun).not.toHaveBeenCalled();
    expect(t.runner.active).toBe(false);
  });

  it("releases the lock when the run finishes and when a start is refused", async () => {
    const t = setup();
    const r = await t.runner.start({ skillId: "s1", trigger: "manual" });
    t.emit({ event: "run.finished", runId: "run1", status: "succeeded" });
    if (r.ok) await r.done;
    expect(t.lock.release).toHaveBeenCalledTimes(1);

    const u = setup();
    u.helper.runStart.mockRejectedValueOnce(new Error("busy"));
    await u.runner.start({ skillId: "s1", trigger: "manual" });
    expect(u.lock.release).toHaveBeenCalledTimes(1);
  });
});

describe("skillRunner run identity and stale gates", () => {
  it("ignores events that name another run", async () => {
    const t = setup();
    await t.runner.start({ skillId: "s1", trigger: "manual" });
    t.emit({ event: "run.stepFinished", runId: "other", idx: 0, outcome: "ok" });
    t.emit({ event: "run.finished", runId: "other", status: "failed" });
    expect(t.store.stepRun).not.toHaveBeenCalled();
    expect(t.store.finishRun).not.toHaveBeenCalled();
    expect(t.runner.active).toBe(true);
  });

  it("an in-window answer for another run or step is ignored", async () => {
    const t = setup();
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", runId: "run1", idx: 0 });
    await vi.waitFor(() => expect(t.relay.answer).toHaveBeenCalled());
    t.runner.answerApproval("old-run", 0, true);
    t.runner.answerApproval("run1", 1, true);
    expect(t.helper.approveAnswer).not.toHaveBeenCalled();
  });

  it("a run that finishes with a gate still open closes the phone copy as rejected and sends no answer", async () => {
    const t = setup();
    const r = await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", runId: "run1", idx: 0 });
    await vi.waitFor(() => expect(t.relay.answer).toHaveBeenCalled());
    t.emit({ event: "run.finished", runId: "run1", status: "stopped" });
    if (r.ok) await r.done;
    expect(t.relay.close).toHaveBeenCalledWith("ap1", false);
    expect(t.helper.approveAnswer).not.toHaveBeenCalled();
  });

  it("dispose answers an open gate no (closing the phone copy) without touching the helper", async () => {
    const t = setup();
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", runId: "run1", idx: 0 });
    await vi.waitFor(() => expect(t.relay.answer).toHaveBeenCalled());
    t.runner.dispose();
    await vi.waitFor(() => expect(t.relay.close).toHaveBeenCalledWith("ap1", false));
    expect(t.helper.approveAnswer).not.toHaveBeenCalled();
  });
});

describe("skillRunner stop during startup", () => {
  it("a Stop pressed before the helper has the run finishes it as stopped and never starts the helper", async () => {
    const t = setup();
    let release!: () => void;
    t.store.startRun.mockImplementationOnce(async (_id: string, trigger: string) => {
      await new Promise<void>((r) => (release = r));
      return { id: "run1", skillId: "s1", skillName: "Invoice", trigger, status: "running", startedAt: 0, steps: [] } as Run;
    });
    const started = t.runner.start({ skillId: "s1", trigger: "manual" });
    await vi.waitFor(() => expect(t.store.startRun).toHaveBeenCalled());
    await t.runner.stop();
    release();
    expect(await started).toEqual({ ok: false, error: "stopped before start" });
    expect(t.helper.runStart).not.toHaveBeenCalled();
    expect(t.store.finishRun).toHaveBeenCalledWith("run1", "stopped", null);
    expect(t.runner.active).toBe(false);
  });
});

describe("skillRunner forgetting a kept secret", () => {
  it("clears it after this run has read it", async () => {
    const t = setup({ secrets: { pin: "kept" } });
    await t.runner.start({ skillId: "s1", trigger: "manual", forget: ["pin"] });
    expect(t.helper.runStart).toHaveBeenCalledWith("run1", t.sk, { pin: "kept" });
    expect(t.secrets.clear).toHaveBeenCalledWith("s1", ["pin"]);
  });
});
