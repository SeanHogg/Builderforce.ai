/**
 * policy/verify/runEndMemory.ts — the verify-then-remember tail every run loop shares,
 * ported from `api/src/application/runtime/cloudAgent/runEndMemory.ts`.
 *
 * TWO findings, ONE seam. A run loop used to end the moment the agent stopped: it never
 * told the run policy it had entered verification, and it never wrote down anything it
 * had learned. Both are fixed here so no loop re-invents them:
 *
 *   1. {@link runVerifyPhase} walks a run through the `verify` phase declared by
 *      `@builderforce/run-policy` — the `verify_started` event in that package's
 *      `RunPolicyEvent` union, which until now NO loop ever emitted. A loop observes the
 *      phase only by feeding the returned event back through `reduceRunPolicy`.
 *
 *   2. {@link applyVerifyPhase} applies that one event through the reducer — the one
 *      call that actually moves a run into its `verify` phase, using the DECLARED event
 *      name (`verify_started`), not an invented one.
 *
 * The memory-write half of the original (`commitRunMemory`) rides the host's memory
 * capability through the PORTS contract (`store.commitMemory` / the `memory` tool) and
 * is therefore owned by the memory policy (WS2e); this module keeps only the parts that
 * decide WHAT a verify phase is and how its verdict reads.
 *
 * No `node:*` imports, no DOM.
 */

import { reduceRunPolicy, type RunPolicyState } from "@builderforce/run-policy";
import { inRunVerifyOutcome, type InRunVerifyOutcome } from "./inRunVerify.js";

/** WHICH runtime ran it — the surface is part of the recorded verdict. */
export type RunVerifySurface = "durable" | "sandbox" | "on-prem" | "brain-reply";

/** Surfaces with a real shell — the ones that may RUN a check rather than only record
 *  one. A chat reply and a DO worker have none, and must never fake one. */
type ShellSurface = Exclude<RunVerifySurface, "durable" | "brain-reply">;
const SHELL_SURFACES: ReadonlySet<RunVerifySurface> = new Set<ShellSurface>(["sandbox", "on-prem"]);
const hasShell = (surface: RunVerifySurface): surface is ShellSurface => SHELL_SURFACES.has(surface);

export interface RunVerifyInput {
  /** WHICH runtime ran it — the surface is part of the recorded verdict. */
  surface: RunVerifySurface;
  /** The files this run actually wrote. Nothing written ⇒ nothing to verify. */
  writtenPaths?: ReadonlySet<string> | readonly string[] | null;
  /** `package.json` scripts, when the caller already read them. */
  packageScripts?: Record<string, string> | null;
  /** Runs one declared script (the package-manager command); `inRunVerifyOutcome`'s runner. */
  runner?: "npm" | "pnpm" | "yarn";
  /** A check already run by the caller (the shell's own exec); supplied instead of a
   *  runner so nothing runs twice. */
  results?: Parameters<typeof inRunVerifyOutcome>[0]["results"];
}

/**
 * The verification action a loop performs before it may finish: the project's own
 * checks over what the run wrote, decided by the unit-tested {@link inRunVerifyOutcome}
 * so every surface draws the SAME line about what counts as verified. It performs
 * nothing itself — it selects the commands from what the caller ran, which is what
 * keeps the durable (shell-less) surface honest.
 */
export function runVerifyPhase(input: RunVerifyInput): InRunVerifyOutcome {
  // A shell-less surface can only RECORD checks its caller already ran; handing it a
  // runner would let a chat reply claim a test run that never happened.
  if (!hasShell(input.surface)) {
    return inRunVerifyOutcome({
      surface: "durable",
      writtenPaths: input.writtenPaths ?? [],
      results: input.results ?? null,
    });
  }
  return inRunVerifyOutcome({
    surface: input.surface === "on-prem" ? "durable" : input.surface,
    writtenPaths: input.writtenPaths ?? [],
    packageScripts: input.packageScripts ?? null,
    runner: input.runner,
    results: input.results ?? null,
  });
}

/** One-line human summary of a verify outcome, for the timeline and the fact body. */
export function describeVerifyOutcome(outcome: InRunVerifyOutcome): string {
  if (outcome.kind === "skipped") return `verify skipped (${outcome.reason})`;
  if (outcome.commands.length === 0) return `verify ${outcome.kind}, no commands`;
  const failed = outcome.failedCommands.length;
  return `verify ${outcome.kind}: ${outcome.commands.join("; ")}${failed > 0 ? ` — ${failed} failed` : ""}`;
}

/**
 * Apply the `verify_started` event through the run policy's reducer and return the new
 * state — the one call that actually moves a run into its `verify` phase.
 *
 * This is the half of finding 11 that the policy cannot fix by itself: the event was
 * DECLARED there and its reducer HANDLED it, but no loop ever emitted it, so the policy
 * meant to gate runs on a verify step never saw one. Every loop applies this instead of
 * inventing its own phase transition (or its own event name).
 */
export function applyVerifyPhase(state: RunPolicyState): RunPolicyState {
  return reduceRunPolicy(state, { type: "verify_started" });
}
