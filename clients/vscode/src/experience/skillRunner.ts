import type { Skill, SkillStep } from "@seanhogg/builderforce-memory-engine";
import type { HelperEvent } from "./teachHelperProtocol";
import {
  APPROVAL_TIMEOUT_MS,
  type LiveRunState,
  type SkillRunnerPorts,
  type StartRequest,
  type StartResult,
} from "./skillRunnerPorts";

export type { LiveRunState, StartRequest, StartResult } from "./skillRunnerPorts";

/** How many of the newest runs are scanned for orphans on activation. */
const ORPHAN_SCAN = 100;

/** A short, unlocalized label for what a step does (it travels in the approval's metadata). */
export function actionLabel(step: SkillStep | undefined): string {
  const a = step?.action;
  if (!a) return "step";
  if (a.kind === "keys") return `keys ${a.keys}`;
  return `${a.kind} ${a.target.name || a.target.automationId}`.trim();
}

/**
 * The values a run is started with, in this order: what the person gave, then the
 * routine's stored values, then the keychain's secrets for the secret parameters still
 * unset. A parameter nobody supplied is left out (the helper fails the run on a missing
 * secret before anything moves; a plain parameter falls back to its recorded default).
 */
export async function resolveRunValues(
  skill: Skill,
  given: Record<string, string>,
  secrets: SkillRunnerPorts["secrets"],
): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...(skill.routine?.values ?? {}), ...given };
  for (const p of skill.params) {
    if (p.secret && !values[p.name]) {
      const kept = await secrets.get(skill.id, p.name);
      if (kept) values[p.name] = kept;
    }
  }
  return values;
}

interface ActiveRun {
  runId: string;
  skill: Skill;
  trigger: string;
  steps: number;
  state: LiveRunState;
  /** Audit writes chain here so `finishRun` lands after the last step. */
  writes: Promise<void>;
  /** Resolves the open gate (in-window answer), when there is one. */
  answerGate?: (approved: boolean) => void;
  finish(): void;
}

export interface SkillRunner {
  readonly active: boolean;
  start(req: StartRequest): Promise<StartResult>;
  /** Ends the run; a gate waiting on a person counts as "no". */
  stop(): Promise<void>;
  /** The in-window answer to the open gate. */
  answerApproval(approved: boolean): void;
  /** Marks runs a previous session left `running` as failed. Returns how many. */
  recoverOrphans(): Promise<number>;
  onState(listener: (state: LiveRunState | null) => void): { dispose(): void };
  dispose(): void;
}

export function createSkillRunner(ports: SkillRunnerPorts): SkillRunner {
  const { helper, store, secrets, relay, clock, messages } = ports;
  const listeners = new Set<(s: LiveRunState | null) => void>();
  let cur: ActiveRun | undefined;
  /** True between `start` being called and the run being claimed or refused. */
  let starting = false;

  const emit = (): void => {
    for (const l of [...listeners]) l(cur ? { ...cur.state } : null);
  };

  /** Run a store write behind the previous ones; a failure is reported and does not break the chain. */
  const queue = (run: ActiveRun, op: string, work: () => Promise<void>): void => {
    run.writes = run.writes.then(work).catch((e) => ports.report(e, op));
  };

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
    emit();
    await helper.approveAnswer(idx, winner.approved);
  }

  async function onFinished(run: ActiveRun, event: Extract<HelperEvent, { event: "run.finished" }>): Promise<void> {
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
    emit();
    run.finish();
  }

  function onEvent(event: HelperEvent): void {
    const run = cur;
    if (!run) return;
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
        askGate(run, event.idx).catch((e) => ports.report(e, "skillRunner:approval"));
        break;
      case "run.finished":
        void onFinished(run, event);
        break;
      default:
        break;
    }
  }

  const subscription = helper.onEvent(onEvent);

  return {
    get active() {
      return cur !== undefined || starting;
    },

    async start(req) {
      // Claimed synchronously, so a second start during the awaits below is refused.
      if (cur || starting) return { ok: false, error: messages.busy };
      starting = true;
      try {
        return await begin(req);
      } finally {
        starting = false;
      }
    },

    async stop() {
      const run = cur;
      if (!run) return;
      run.answerGate?.(false);
      try {
        await helper.runStop();
      } catch (e) {
        ports.report(e, "skillRunner:stop");
      }
    },

    answerApproval(approved) {
      cur?.answerGate?.(approved);
    },

    async recoverOrphans() {
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
      subscription.dispose();
      listeners.clear();
    },
  };

  async function begin(req: StartRequest): Promise<StartResult> {
    {
      if (!(await helper.probe()).supported) return { ok: false, error: messages.unsupported };
      const skill = await store.getSkill(req.skillId);
      if (!skill) return { ok: false, error: messages.unknownSkill(req.skillId) };
      // From here the run is `cur`, so `active` stays true for its whole life.
      let finish!: () => void;
      const done = new Promise<void>((resolve) => (finish = resolve));
      const placeholder: ActiveRun = {
        runId: "",
        skill,
        trigger: req.trigger,
        steps: skill.steps.length,
        state: { runId: "", skillId: skill.id, skillName: skill.name, trigger: req.trigger, totalSteps: skill.steps.length, currentStep: null, approval: null },
        writes: Promise.resolve(),
        finish,
      };
      cur = placeholder;
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
        try {
          await helper.runStart(skill, values);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          await store.finishRun(run.id, "failed", error);
          cur = undefined;
          emit();
          finish();
          return { ok: false, error };
        }
        return { ok: true, runId: run.id, done };
      } catch (e) {
        ports.report(e, "skillRunner:start");
        cur = undefined;
        emit();
        finish();
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
}
