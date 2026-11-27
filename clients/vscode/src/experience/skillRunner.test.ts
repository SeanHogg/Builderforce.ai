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
  const ports: SkillRunnerPorts = { helper, store, secrets, relay, clock, messages, remember, report };
  const runner = createSkillRunner(ports);
  return { runner, helper, store, secrets, relay, clock, remember, report, calls, emit: (e: HelperEvent) => listener(e), fire: () => fireTimeout(), sk };
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
    expect(t.helper.runStart).toHaveBeenCalledWith(t.sk, { amount: "9", pin: "kept" });
    t.emit({ event: "run.stepStarted", idx: 0 });
    t.emit({ event: "run.stepFinished", idx: 0, outcome: "ok" });
    t.emit({ event: "run.stepFinished", idx: 1, outcome: "fallback", detail: "by position" });
    t.emit({ event: "run.finished", status: "succeeded" });
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
    t.emit({ event: "run.approvalNeeded", idx: 0 });
    await vi.waitFor(() => expect(t.relay.answer).toHaveBeenCalled());
  }

  it("the in-window answer wins and the phone's copy is closed", async () => {
    const t = setup();
    await atGate(t);
    t.runner.answerApproval(true);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, true));
    expect(t.relay.close).toHaveBeenCalledWith("ap1", true);
    expect((t.relay.answer.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
    expect(t.relay.open).toHaveBeenCalledWith(expect.objectContaining({ runId: "run1", skill: "Invoice", step: 1, action: "click Send", description: "Invoice #1: click Send" }));
  });

  it("the phone wins when it answers first, and is not PATCHed again", async () => {
    const t = setup({ relayAnswer: async () => true });
    await atGate(t);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, true));
    expect(t.relay.close).not.toHaveBeenCalled();
  });

  it("a phone refusal is a no", async () => {
    const t = setup({ relayAnswer: async () => false });
    await atGate(t);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, false));
  });

  it("a 15 minute timeout is a no", async () => {
    const t = setup();
    await atGate(t);
    expect(t.clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), APPROVAL_TIMEOUT_MS);
    t.fire();
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, false));
    expect(t.relay.close).toHaveBeenCalledWith("ap1", false);
  });

  it("Stop is a no, and stops the helper", async () => {
    const t = setup();
    await atGate(t);
    await t.runner.stop();
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, false));
    expect(t.helper.runStop).toHaveBeenCalled();
    expect(t.relay.close).toHaveBeenCalledWith("ap1", false);
  });

  it("works with no phone relay (signed out): only the window can answer", async () => {
    const t = setup();
    t.relay.open.mockResolvedValueOnce(undefined);
    await t.runner.start({ skillId: "s1", trigger: "manual", values: { pin: "1" } });
    t.emit({ event: "run.approvalNeeded", idx: 0 });
    await vi.waitFor(() => expect(t.clock.setTimeout).toHaveBeenCalled());
    t.runner.answerApproval(false);
    await vi.waitFor(() => expect(t.helper.approveAnswer).toHaveBeenCalledWith(0, false));
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
});
