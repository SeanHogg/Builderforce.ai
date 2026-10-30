/**
 * telemetry/runTally — the per-RUN counters the §8.2 outcome row reads (PRD 35 WS6).
 *
 * The tally lives on `RunState.telemetry`, so it crosses a step boundary with the rest
 * of the state: a cloud run driven one tick at a time (`maxSteps: 1`) totals exactly
 * what the same run driven continuously totals, and the row — written once, when the
 * run ends — counts the whole run, not its last tick.
 *
 * Every counter is fed by the driver at the point the fact happens (a model turn, a
 * dispatched call, a verify verdict), from the SAME verdict the event trace records, so
 * the row and the trace never disagree. PURE: plain JSON in, plain JSON out.
 */

import { isNotARepo, resolveToolAlias } from "@builderforce/agent-tools";
import { parseShellFileRead } from "@builderforce/run-guards";
import type { ModelUsage } from "../contract.js";
import { isSpawnTool } from "../policy/subagents/delegationRequest.js";
import { foldTurnCost } from "./costTally.js";

/** What a run has spent and done so far — carried on `RunState.telemetry`. */
export interface RunTally {
  /** Tool calls dispatched (covered-read stubs never ran, so they are not calls). */
  toolCalls: number;
  /** Dispatched calls that errored. */
  toolErrors: number;
  /** The model the last turn was served by. */
  model?: string;
  /** Input + output tokens across every turn. */
  tokens: number;
  /** Prompt-cache reads across every turn. */
  cacheReadTokens: number;
  /** The run's cost so far (see `costTally.ts`): the millicents billed while every turn was priced, `null` once a
   *  turn was not (unknown, never a partial sum), absent before any turn. Read it with `reportedRunCost`. */
  costMc?: number | null;
  /** The step the first `spawn_agent(s)` call was dispatched on; absent ⇒ nothing spawned. */
  firstSpawnTurn?: number;
  /** `cat`/`sed`/`head`/`tail` prints of one workspace file through the shell. */
  shellFileReads: number;
  /** Calls that came back "not a git repository". */
  repoErrors: number;
  /** The run-end verify's verdict, when the declared verify ran. */
  verify?: "passed" | "failed";
}

/** A fresh run's tally: nothing spent, nothing done. */
export function freshTally(): RunTally {
  return { toolCalls: 0, toolErrors: 0, tokens: 0, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0 };
}

/** The tally a resumed state carries, with every counter present even if an older writer omitted one. */
export function resumeTally(saved: Partial<RunTally> | undefined): RunTally {
  return { ...freshTally(), ...(saved ?? {}) };
}

/** One model turn answered: who served it and what it cost. */
export function tallyTurn(tally: RunTally, model: string | undefined, usage: ModelUsage | undefined): void {
  if (model) tally.model = model;
  // A turn with no usage at all is an unpriced turn too: it latches the run's cost unknown.
  tally.costMc = foldTurnCost(tally.costMc, usage?.costMc);
  if (!usage) return;
  tally.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  tally.cacheReadTokens += usage.cacheReadTokens ?? 0;
}

/** One dispatched call: counted, and read for the §8.2 efficiency facts it carries. */
export function tallyCall(tally: RunTally, step: number, name: string, args: Record<string, unknown>, data: unknown, ok: boolean): void {
  tally.toolCalls += 1;
  if (!ok) tally.toolErrors += 1;
  if (isSpawnTool(name) && tally.firstSpawnTurn === undefined) tally.firstSpawnTurn = step;
  if (resolveToolAlias(name) === "run_command" && typeof args.command === "string" && parseShellFileRead(args.command)) {
    tally.shellFileReads += 1;
  }
  if (!ok && isNotARepo(errorText(data))) tally.repoErrors += 1;
}

/** The run-end verify answered. */
export function tallyVerify(tally: RunTally, ok: boolean): void {
  tally.verify = ok ? "passed" : "failed";
}

/** The text a failed result carries, in the shape `isNotARepo` reads. */
function errorText(data: unknown): { stdout?: string; error?: string } {
  if (typeof data === "string") return { error: data };
  if (!data || typeof data !== "object") return {};
  const d = data as { stdout?: unknown; stderr?: unknown; error?: unknown };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return { stdout: `${str(d.stdout)} ${str(d.stderr)}`, error: str(d.error) };
}
