import type { Skill } from "@seanhogg/builderforce-memory-engine";
import type { HelperEvent } from "./teachHelperProtocol";
import { actionLabel, resolveRunValues } from "./skillRunValues";
import {
  APPROVAL_TIMEOUT_MS,
  type LiveRunState,
  type SkillRunnerPorts,
  type StartRequest,
  type StartResult,
} from "./skillRunnerPorts";

export { actionLabel, resolveRunValues } from "./skillRunValues";
export type { LiveRunState, StartRequest, StartResult } from "./skillRunnerPorts";

/** How many of the newest runs are scanned for orphans on activation. */
const ORPHAN_SCAN = 100;

interface ActiveRun {
  runId: string;
  skill: Skill;
  trigger: string;
  state: LiveRunState;
  /** Audit writes chain here so `finishRun` lands after the last step. */
  writes: Promise<void>;
  /** Resolves the open gate (in-window answer), when there is one. */
  answerGate?: (approved: boolean) => void;
  /** The open gate's whole life (race, phone close, answer to the helper). */
  gate?: Promise<void>;
  /** The run is over: nothing more may be sent to the helper for it. */
  ended: boolean;
  finish(): void;
}

export interface SkillRunner {
  readonly active: boolean;
  start(req: StartRequest): Promise<StartResult>;
  /** Ends the run; a gate waiting on a person counts as "no". Also cancels a start still under way. */
  stop(): Promise<void>;
  /** The in-window answer to the open gate; ignored unless it names the gate that is open. */
  answerApproval(runId: string, idx: number, approved: boolean): void;
  /** Another editor window is running a skill. */
  blockedElsewhere(): Promise<boolean>;
  /** Marks runs a previous session left `running` as failed. Returns how many. */
  recoverOrphans(): Promise<number>;
  onState(listener: (state: LiveRunState | null) => void): { dispose(): void };
  dispose(): void;
}

export function createSkillRunner(ports: SkillRunnerPorts): SkillRunner {
  const { helper, store, secrets, relay, lock, clock, messages } = ports;
  const listeners = new Set<(s: LiveRunState | null) => void>();
  let cur: ActiveRun | undefined;
  /** True between `start` being called and the run being claimed or refused. */
  let starting = false;
  /** Stop was pressed while a start was still under way. */
  let stopRequested = false;
  let disposed = false;

  const emit = (): void => {
    for (const l of [...listeners]) l(cur ? { ...cur.state } : null);
  };

  /** Run a store write behind the previous ones; a failure is reported and does not break the chain. */
  const queue = (run: ActiveRun, op: string, work: () => Promise<void>): void => {
    run.writes = run.writes.then(work).catch((e) => ports.report(e, op));
  };

  const unlock = (): Promise<void> => lock.release().catch((e) => ports.report(e, "skillRunner:unlock"));

  /** One gate: the in-window answer races the phone; a timeout or a Stop is "no". */
  async function askGate(run: ActiveRun, idx: number): Promise<void> {
    const step = run.skill.steps[idx];
    const description = messages.approvalDescription(run.skill.name, idx + 1, actionLabel(step));
    run.state.approval = { idx, description };
    emit();
    const gate = new AbortController();
    let timer: unknown;
    const window = new Promise<{ from: "window"; approved: boolean }>((resolve) => {
      run.answerGate = (approved) => resolve({ from: "window", approved });
    });
    const timeout = new Promise<{ from: "timeout"; approved: false }>((resolve) => {
      timer = clock.setTimeout(() => resolve({ from: "timeout", approved: false }), APPROVAL_TIMEOUT_MS);
    });
    const approvalId = await relay.open({
      runId: run.runId,
      skill: run.skill.name,
      step: idx + 1,
      action: actionLabel(step),
      description,
      expiresInMs: APPROVAL_TIMEOUT_MS,
    });
    const racers: Array<Promise<{ from: "window" | "phone" | "timeout"; approved: boolean }>> = [window, timeout];
    if (approvalId) {
      racers.push(
        relay.answer(approvalId, gate.signal).then((v) => (v === undefined ? new Promise<never>(() => undefined) : { from: "phone" as const, approved: v })),
      );
    }
    const winner = await Promise.race(racers);
    gate.abort();
    clock.clearTimeout(timer);
    run.answerGate = undefined;
    // The phone answered itself; every other way out closes the phone's copy.
    if (approvalId && winner.from !== "phone") await relay.close(approvalId, winner.approved);
    run.state.approval = null;
    // A run that ended (or a closed runner) has no gate left to answer.
    if (cur !== run || run.ended || disposed) return;
    emit();
    await helper.approveAnswer(run.runId, idx, winner.approved);
  }

  async function onFinished(run: ActiveRun, event: Extract<HelperEvent, { event: "run.finished" }>): Promise<void> {
    // A gate still open when the run ends is answered "no" first, which also closes the phone's copy as rejected.
    run.answerGate?.(false);
    run.ended = true;
    await run.gate;
    await run.writes;
    try {
      await store.finishRun(run.runId, event.status, event.error ?? null);
    } catch (e) {
      ports.report(e, "skillRunner:finishRun");
    }
    const at = new Date(clock.now()).toISOString();
    try {
      await ports.remember({
        key: `synapse.skill.${run.skill.id}.last-run`,
        content: messages.lastRun(run.skill.name, event.status, at, run.trigger),
        tags: ["synapse", "skill-run"],
      });
    } catch (e) {
      ports.report(e, "skillRunner:remember");
    }
    if (cur === run) cur = undefined;
    await unlock();
    emit();
    run.finish();
  }

  function onEvent(event: HelperEvent): void {
    const run = cur;
    if (!run || event.event === "record.step") return;
    // Events of any run but the current one (a late line from a run already finished) are not ours.
    if (event.runId !== run.runId) return;
    switch (event.event) {
      case "run.stepStarted":
        run.state.currentStep = event.idx + 1;
        emit();
        break;
      case "run.stepFinished":
        queue(run, "skillRunner:stepRun", () =>
          store.stepRun({
            runId: run.runId,
            idx: event.idx,
            stepId: run.skill.steps[event.idx]?.id ?? String(event.idx),
            outcome: event.outcome,
            detail: event.detail ?? null,
          }),
        );
        break;
      case "run.approvalNeeded":
        run.gate = askGate(run, event.idx).catch((e) => ports.report(e, "skillRunner:approval"));
        break;
      case "run.finished":
        void onFinished(run, event);
        break;
    }
  }

  const subscription = helper.onEvent(onEvent);

  async function begin(req: StartRequest): Promise<StartResult> {
    if (!(await helper.probe()).supported) return { ok: false, error: messages.unsupported };
    const skill = await store.getSkill(req.skillId);
    if (!skill) return { ok: false, error: messages.unknownSkill(req.skillId) };
    if (!(await lock.acquire())) return { ok: false, error: messages.lockedElsewhere };
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    // From here the run is `cur`, so `active` stays true for its whole life.
    const placeholder: ActiveRun = {
      runId: "",
      skill,
      trigger: req.trigger,
      state: { runId: "", skillId: skill.id, skillName: skill.name, trigger: req.trigger, totalSteps: skill.steps.length, currentStep: null, approval: null },
      writes: Promise.resolve(),
      ended: false,
      finish,
    };
    cur = placeholder;
    const abandon = async (): Promise<void> => {
      cur = undefined;
      await unlock();
      emit();
      finish();
    };
    try {
      for (const name of req.remember ?? []) {
        const v = req.values?.[name];
        if (v) await secrets.set(skill.id, name, v);
      }
      const run = await store.startRun(skill.id, req.trigger);
      placeholder.runId = run.id;
      placeholder.state.runId = run.id;
      emit();
      const values = await resolveRunValues(skill, req.values ?? {}, secrets);
      // Unticked "Remember": the kept secret served this run and is forgotten now.
      if (req.forget?.length) await secrets.clear(skill.id, req.forget);
      if (stopRequested) {
        await store.finishRun(run.id, "stopped", null);
        await abandon();
        return { ok: false, error: messages.stopped };
      }
      try {
        await helper.runStart(run.id, skill, values);
      } catch (e) {
        const error = messages.explain(e);
        await store.finishRun(run.id, "failed", error);
        await abandon();
        return { ok: false, error };
      }
      // Stop pressed while `run.start` was in flight: the helper has the run now, so stop it.
      if (stopRequested) await helper.runStop().catch((e) => ports.report(e, "skillRunner:stop"));
      return { ok: true, runId: run.id, done };
    } catch (e) {
      ports.report(e, "skillRunner:start");
      await abandon();
      return { ok: false, error: messages.explain(e) };
    }
  }

  return {
    get active() {
      return cur !== undefined || starting;
    },

    async start(req) {
      // Claimed synchronously, so a second start during the awaits below is refused.
      if (cur || starting) return { ok: false, error: messages.busy };
      starting = true;
      stopRequested = false;
      try {
        return await begin(req);
      } finally {
        starting = false;
      }
    },

    async stop() {
      const run = cur;
      if (!run && !starting) return;
      stopRequested = true;
      run?.answerGate?.(false);
      // Before the helper has the run there is nothing to stop: `begin` sees the flag.
      if (!run || !run.runId || starting) return;
      try {
        await helper.runStop();
      } catch (e) {
        ports.report(e, "skillRunner:stop");
      }
    },

    answerApproval(runId, idx, approved) {
      const run = cur;
      if (!run || run.runId !== runId || run.state.approval?.idx !== idx) return;
      run.answerGate?.(approved);
    },

    blockedElsewhere: () => lock.heldByOther(),

    async recoverOrphans() {
      // A `running` run is live (not orphaned) when another window holds the lock.
      if (await lock.heldByOther()) return 0;
      let n = 0;
      for (const run of await store.listRuns(ORPHAN_SCAN)) {
        if (run.status !== "running") continue;
        try {
          await store.finishRun(run.id, "failed", messages.orphaned);
          n++;
        } catch (e) {
          ports.report(e, "skillRunner:orphan");
        }
      }
      return n;
    },

    onState(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },

    dispose() {
      disposed = true;
      // An open gate is answered "no"; its race closes the phone's copy (fire and forget).
      cur?.answerGate?.(false);
      subscription.dispose();
      listeners.clear();
    },
  };
}
