/**
 * What the user steered in, and when the kernel takes it: before a model call, while a `finish` call is in flight, and once the
 * run would otherwise stop (a queued follow-up). Split out of `kernelHooks.ts` (PRD 35 §5 rule 4): the WHEN is the kernel's,
 * the decisions (a stop command, how a steer is worded) are `policy/steering`'s.
 */

import type { RunMessage, RunPart } from "./contract.js";
import type { PolicyContext } from "./policy/index.js";
import { isStopSteer, steerInput } from "./policy/steering/index.js";
import { appendRows, emit } from "./runContext.js";
import type { KernelRun } from "./kernelHooks.js";

type StepAt = { step: number; stepInCall: number };

/** The takers for one run: each reads the steering port and puts what it finds where the run reads it. */
export function steeringTakers(run: KernelRun, contextAt: (step: number, turn: number) => PolicyContext) {
  const { input, hooks } = run;
  const { ports } = input;
  // A surface whose Stop is its own control (`RunPolicy.stopWords: false`) never reads a steered word as a command.
  const stopsOn = (texts: readonly string[]): boolean => input.policy.stopWords !== false && isStopSteer(texts);
  const append = (...rows: RunMessage[]): void => appendRows(input, run.transcript, ...rows);

  /**
   * Take what the user steered in: a stop command ends the run (the model never gets
   * another turn after a stop, §6.3); anything else becomes the next user turn, each
   * acknowledged with `steer.applied` before the turn it reaches.
   */
  const takeSteers = async (ctx: StepAt): Promise<"none" | "stop" | "applied"> => {
    const steered = ((await ports.steering?.drain({ step: ctx.step })) ?? []).map(steerInput);
    if (steered.length === 0) return "none";
    const texts = steered.map((s) => s.text);
    if (stopsOn(texts)) {
      run.stopped = true;
      return "stop";
    }
    const injected = await hooks.steering.inject(contextAt(ctx.step, ctx.stepInCall), texts);
    const rows = injected ?? texts.map((text): RunMessage => ({ role: "user", content: text }));
    // A picture the person attached rides the row it becomes (rows and messages line up one to one). Every row is the person's own words.
    append(...rows.map((row, i): RunMessage => ({ ...row, ...(rows.length === steered.length && steered[i]?.parts?.length && !row.parts ? { parts: steered[i]!.parts } : {}), person: true })));
    for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    return "applied";
  };

  /**
   * What the user steered in while the last prose turn was written, for a surface that takes it FIRST (`DeliveryLedger.stall.steersFirst`):
   * the words of every steer joined into ONE user turn (their pictures riding it), acknowledged with `steer.applied` each. A stop
   * command ends the run, as it does anywhere else. The caller sends the turn back with the words.
   */
  const takeJoined = async (ctx: { step: number }): Promise<"none" | "stop" | { text: string; parts: RunPart[] }> => {
    const steered = ((await ports.steering?.drain({ step: ctx.step })) ?? []).map(steerInput);
    if (steered.length === 0) return "none";
    const texts = steered.map((s) => s.text);
    if (stopsOn(texts)) {
      run.stopped = true;
      return "stop";
    }
    for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    return { text: texts.join("\n\n"), parts: steered.flatMap((s) => s.parts ?? []) };
  };

  /**
   * What the user steered in while a `finish` call was in flight, as the note the finish is
   * answered with; null when nothing was steered (the finish stands). A stop command lets
   * the finish stand and settles the run cancelled, as it does anywhere else.
   */
  const lateSteerNote = async (ctx: { step: number }): Promise<{ note: string } | null> => {
    const steered = ((await ports.steering?.drain({ step: ctx.step })) ?? []).map(steerInput);
    if (steered.length === 0) return null;
    const texts = steered.map((s) => s.text);
    if (stopsOn(texts)) {
      run.stopped = true;
      return null;
    }
    for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    const many = texts.length > 1;
    return {
      note:
        `The user sent ${many ? "messages" : "a message"} while you were finishing, so do not finish yet:\n` +
        `${texts.map((t) => `- ${t}`).join("\n")}\nAddress ${many ? "them" : "it"}, then finish.`,
    };
  };

  /** What the person queued to be taken once the run would stop: each becomes a user turn, and the run continues on them. */
  const takeFollowUps = async (ctx: { step: number }): Promise<boolean> => {
    const followUps = ((await ports.steering?.followUp?.()) ?? []).map(steerInput);
    if (followUps.length === 0) return false;
    append(...followUps.map((f): RunMessage => ({ role: "user", content: f.text, person: true, ...(f.parts?.length ? { parts: f.parts } : {}) })));
    for (let i = 0; i < followUps.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
    return true;
  };

  return { takeSteers, takeJoined, lateSteerNote, takeFollowUps };
}
