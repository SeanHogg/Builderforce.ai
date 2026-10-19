/**
 * run-outcome-memory — the on-prem mirror of the cloud run's memory commit.
 *
 * A cloud run ends by calling `commitRunMemory` (api/src/application/runtime/
 * cloudAgent/runEndMemory.ts): it writes what the run learned into the governed
 * memory store under a stable `run-outcome:<scope>:<id>` key, tagged
 * `run-outcome`. The embedded runner could not copy that call in-process — it
 * holds no `Db` and no `Env`, which is exactly why the cloud twin is
 * unreachable from here — so this module reaches the SAME durable store over
 * HTTP instead, through the door the runtime already authenticates on
 * (`Authorization: Bearer` + `X-AgentHost-Id`, the pair every other
 * agent-runtime → api caller uses).
 *
 * WHY THE FACTS DOOR AND NOT /api/teams/memory: both routes are host-authed and
 * both land in `memoryService.remember`, but only the project-facts door lets
 * the CALLER supply the memory key. `teamMemoryRoutes` (api/src/presentation/
 * routes/teamMemoryRoutes.ts) computes its own — `teamMemoryKey(agentHostId,
 * runId)` — so a run-outcome posted there would be filed under a mesh key, not
 * `run-outcome:<scope>:<id>`, and would not be the same KIND of fact a cloud
 * run writes. Mirroring the key is the point of this module, so it takes the
 * facts door (`pushProjectFact`, the same helper the per-file write-through
 * beliefs already use).
 *
 * RECORD-ONLY verify, never a shell. `commitRunMemory` lives beside
 * `runVerifyPhase`, and this module does NOT call it and does NOT start a
 * runner. The embedded runner's tool loop is the only check that happened;
 * {@link selectRecordOnlyVerify} takes those already-finished
 * `{ command, exitCode }` results — the same input shape `inRunVerifyOutcome`
 * / `runVerifyPhase` use — and records what they did. `verify_started` is
 * emitted only when one of those results is already in hand. Completion, when
 * there are real results, is a timeline event (`toolName: 'in_run_verify'`,
 * `category: 'tool'`). `verify_completed` does not exist and is not emitted.
 * A run that changed nothing and ran no check records nothing. `mayFinish` is
 * always true: a failed check is a line in the fact, never a thrown error and
 * never a reason to delay or fail the finished run.
 *
 * BEST-EFFORT BY CONTRACT. A run that finished is a finished run: this never
 * throws, never rejects, and never blocks the run that called it. A memory
 * failure is observable at debug level and nothing more.
 */
import { logDebug } from "../logger.js";
import { pushProjectFact } from "./project-facts-sync.js";
import type { ProjectFactsSyncConfig } from "./project-facts-sync.js";

/** Credentials + target for one host's write to the shared memory store. */
export type RunOutcomeMemoryConfig = ProjectFactsSyncConfig;

/** Facts below this length are noise; a "learning" of four words teaches nothing.
 *  The same floor `commitRunMemory` applies (MIN_COMMIT_BODY there). */
const MIN_COMMIT_BODY = 24;

/** How many written paths one fact will name, matching the cloud twin's slice. */
const MAX_PATHS = 25;

export interface RunOutcomeMemoryInput {
  /** What the run DID — its own summary of the work, the fact the next run needs. */
  summary: string;
  /** The files the run wrote, so the fact points at them. */
  writtenPaths?: readonly string[];
  /** An extra fact worth keeping (an in-run failure worth not repeating). */
  learning?: string;
  /**
   * Tool names the run's own loop already invoked. Record-only verify reads
   * these and nothing else — it never starts a shell to discover more.
   * A name is not an exit code: it can say a check tool was called, and it
   * cannot emit `verify_started`.
   */
  toolNames?: readonly string[];
  /**
   * Check results the agent's own tool loop already produced
   * (`{ command, exitCode }`, the same shape `inRunVerifyOutcome` takes as
   * `results`). Never a shell this runtime started.
   */
  results?: readonly RecordedCheckResult[] | null;
  /** Extra tags, appended after `run-outcome` exactly as the cloud twin does. */
  tags?: readonly string[];
  /**
   * Identifies the run in the key. A cloud run uses its execution id; an on-prem
   * run has no execution row, so its run id plays that part. Pass the value
   * through unchanged — the caller owns it and the key stays stable per run.
   */
  runId?: string;
}

/**
 * The memory key a cloud run's `commitRunMemory` would have written for this
 * run: `run-outcome:<scope>:<id>`. Scoped to the project because that is the
 * scope the facts door serves; a cloud run with a ticket narrows to
 * `ticket-<id>`, which an on-prem run cannot claim — it has no ticket row, and
 * a fabricated one would be a fact about a run that never existed.
 *
 * Mirrors the cloud twin's boundedness: the id is truncated so a runaway
 * caller cannot push the key past a storage limit.
 */
export function runOutcomeFactKey(cfg: RunOutcomeMemoryConfig, runId: string): string {
  const id = runId.trim().slice(0, 120);
  return `run-outcome:project-${cfg.projectId}:${id || "run"}`;
}

/**
 * One check the agent's own tool loop already finished. Same shape as
 * `InRunVerifyCommandResult` (`command` + `exitCode`). This module never
 * produces one by starting a shell.
 */
export type RecordedCheckResult = { command: string; exitCode: number };

/**
 * Record-only outcome. Same fields as `InRunVerifyOutcome`, narrowed to the
 * on-prem record path: no `pending` (we do not wait on a shell we will not
 * start), no `no_shell` / `no_scripts` / `not_yet_run` (those are plans).
 * `mayFinish` is always true — a failure is recorded, never a gate.
 */
export type OnPremVerifyOutcome = {
  surface: "on-prem";
  kind: "skipped" | "ran";
  reason: "nothing_written" | "no_check_ran" | "verify_failed" | "verify_passed" | null;
  commands: string[];
  failedCommands: string[];
  mayFinish: true;
  note: string;
};

/** Policy event. Emitted only when a real `{ command, exitCode }` is in hand. */
export type OnPremVerifyStartedEvent = { type: "verify_started" };

/**
 * Completion. A timeline event, not a policy union member. `verify_completed`
 * is not a member of this type and must not be added.
 */
export type OnPremVerifyTimelineEvent = {
  toolName: "in_run_verify";
  category: "tool";
  detail: {
    event: "in_run_verify";
    surface: "on-prem";
    outcome: OnPremVerifyOutcome;
  };
  result: string;
};

export type OnPremVerifyEvent = OnPremVerifyStartedEvent | OnPremVerifyTimelineEvent;

/**
 * Tools whose having run is evidence the agent's own loop already checked
 * something. Matched on the tool name only — this function has no runner and
 * must not grow one. A name not in this set is not reported as a check.
 * `run_checks` is the catalog verify tool. `run_command` is not: a shell can
 * do anything, so only a command that already looks like a check is recorded,
 * and only when the loop already ran it.
 */
const CHECK_TOOLS = new Set([
  "test",
  "typecheck",
  "lint",
  "build",
  "exec",
  "shell",
  "run_checks",
]);

function wrotePaths(paths: readonly string[] | null | undefined): boolean {
  return (paths ?? []).some((p) => typeof p === "string" && !!p.trim());
}

function namedChecks(toolNames: readonly string[] | null | undefined): string[] {
  return [...new Set((toolNames ?? []).filter((t) => CHECK_TOOLS.has(t)))];
}

/** Last exit code wins, so a retried command is recorded once. */
function normalizeResults(
  results: readonly RecordedCheckResult[] | null | undefined,
): RecordedCheckResult[] {
  const byCommand = new Map<string, number>();
  for (const r of results ?? []) {
    if (!r || typeof r.command !== "string" || !r.command.trim()) {
      continue;
    }
    if (typeof r.exitCode !== "number" || !Number.isFinite(r.exitCode)) {
      continue;
    }
    byCommand.set(r.command.trim(), r.exitCode);
  }
  return [...byCommand.entries()].map(([command, exitCode]) => ({ command, exitCode }));
}

function looksLikeCheckCommand(command: string): boolean {
  return /\b(test|typecheck|type-check|lint|build)\b/i.test(command);
}

/**
 * The selection `runVerifyPhase` / `inRunVerifyOutcome` perform, record-only.
 *
 * Inputs are what the tool loop already finished. There is no `runner`, no
 * package.json plan, and no `pending` state — those exist to drive a shell,
 * and this path does not have one. `null` means record nothing: the run
 * changed no file and ran no check, so there is no verify line and no event.
 */
export function selectRecordOnlyVerify(input: {
  writtenPaths?: readonly string[] | null;
  toolNames?: readonly string[] | null;
  results?: readonly RecordedCheckResult[] | null;
}): { outcome: OnPremVerifyOutcome; events: OnPremVerifyEvent[] } | null {
  const wrote = wrotePaths(input.writtenPaths);
  const results = normalizeResults(input.results);
  const named = namedChecks(input.toolNames);

  if (results.length > 0) {
    const failed = results.filter((r) => r.exitCode !== 0);
    const commands = results.map((r) => r.command);
    const passed = failed.length === 0;
    const listed = (rows: RecordedCheckResult[]) =>
      rows.map((r) => `${r.command} (exit ${r.exitCode})`).join(", ");
    const note = passed
      ? `verify passed: ${listed(results)} (agent tools, not a runtime shell)`
      : `verify failed: ${listed(failed)} (agent tools, not a runtime shell)`;
    const outcome: OnPremVerifyOutcome = {
      surface: "on-prem",
      kind: "ran",
      reason: passed ? "verify_passed" : "verify_failed",
      commands,
      failedCommands: failed.map((r) => r.command),
      mayFinish: true,
      note,
    };
    return {
      outcome,
      events: [
        { type: "verify_started" },
        {
          toolName: "in_run_verify",
          category: "tool",
          detail: { event: "in_run_verify", surface: "on-prem", outcome },
          result: note,
        },
      ],
    };
  }

  // A tool name is not an exit code. Say what the loop called, and do not
  // emit verify_started — that event means a result is already in hand.
  if (!wrote && named.length === 0) {
    return null;
  }
  if (!wrote) {
    const note = "verify skipped (nothing_written)";
    return {
      outcome: {
        surface: "on-prem",
        kind: "skipped",
        reason: "nothing_written",
        commands: named,
        failedCommands: [],
        mayFinish: true,
        note,
      },
      events: [],
    };
  }
  if (named.length === 0) {
    const note = "verify skipped (no_check_ran)";
    return {
      outcome: {
        surface: "on-prem",
        kind: "skipped",
        reason: "no_check_ran",
        commands: [],
        failedCommands: [],
        mayFinish: true,
        note,
      },
      events: [],
    };
  }
  const note = `verify recorded: ${named.join(", ")} (agent tools, not a runtime shell)`;
  return {
    outcome: {
      surface: "on-prem",
      kind: "ran",
      reason: null,
      commands: named,
      failedCommands: [],
      mayFinish: true,
      note,
    },
    events: [],
  };
}

/**
 * The on-prem verify note, or `null` when there is nothing to record (no
 * files changed and no check ran). Record only. Never a shell. A name-only
 * check does not emit `verify_started`; that happens in
 * {@link recordOnPremVerify} and only when a real result is in hand.
 */
export function recordOnlyVerifyNote(input: {
  writtenPaths?: readonly string[] | null;
  toolNames?: readonly string[] | null;
  results?: readonly RecordedCheckResult[] | null;
}): string | null {
  return selectRecordOnlyVerify(input)?.outcome.note ?? null;
}

/**
 * Emit the verify events for one finished run. A recorder that throws is
 * logged and swallowed: bookkeeping must not fail or delay the run that
 * already finished. Returns the fact note (`null` = record nothing).
 */
export function recordOnPremVerify(
  input: {
    writtenPaths?: readonly string[] | null;
    toolNames?: readonly string[] | null;
    results?: readonly RecordedCheckResult[] | null;
  },
  record?: (event: OnPremVerifyEvent) => void,
): { note: string | null; outcome: OnPremVerifyOutcome | null } {
  const selected = selectRecordOnlyVerify(input);
  if (record && selected) {
    for (const event of selected.events) {
      try {
        record(event);
      } catch (err) {
        logDebug(`[run-outcome-memory] verify recorder threw: ${String(err)}`);
      }
    }
  }
  return { note: selected?.outcome.note ?? null, outcome: selected?.outcome ?? null };
}

function toolNameOf(data: Record<string, unknown>): string | null {
  const raw = data["name"] ?? data["toolName"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function argsOf(
  data: Record<string, unknown>,
  pendingArgs?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const args = data["args"];
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return pendingArgs ?? null;
}

/**
 * A check result from one tool-loop event the embedded runner already
 * emitted. `null` when the event is not a finished check — a start, a read,
 * a `run_checks` that did not run, a `run_command` that is not a check.
 * Never starts a shell to find out.
 */
export function checkResultFromToolEvent(
  data: Record<string, unknown>,
  pendingArgs?: Record<string, unknown> | null,
): RecordedCheckResult | null {
  const phase = data["phase"];
  if (phase !== "result" && typeof data["isError"] !== "boolean") {
    return null;
  }
  const name = toolNameOf(data);
  if (!name) {
    return null;
  }
  const args = argsOf(data, pendingArgs);
  const result = data["result"];
  const resultObj =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  // Invoked, but the tool itself says it did not run a check.
  if (resultObj && resultObj["ran"] === false) {
    return null;
  }

  let command: string | null = null;
  if (name === "run_command") {
    const cmd = args && typeof args["command"] === "string" ? args["command"].trim() : "";
    if (!cmd || !looksLikeCheckCommand(cmd)) {
      return null;
    }
    command = cmd;
  } else if (CHECK_TOOLS.has(name)) {
    const cmd = args && typeof args["command"] === "string" ? args["command"].trim() : "";
    command = cmd || name;
  } else {
    return null;
  }

  if (resultObj && typeof resultObj["exitCode"] === "number" && Number.isFinite(resultObj["exitCode"])) {
    return { command, exitCode: resultObj["exitCode"] };
  }
  if (resultObj && typeof resultObj["ok"] === "boolean") {
    return { command, exitCode: resultObj["ok"] ? 0 : 1 };
  }
  if (data["isError"] === true) {
    return { command, exitCode: 1 };
  }
  if (phase === "result" || data["isError"] === false) {
    return { command, exitCode: 0 };
  }
  return null;
}

/**
 * Build the fact body: the cloud twin joins `[body, verifyNote?, "changed: …"]`
 * with newlines. The verify line is {@link recordOnlyVerifyNote} — omitted
 * entirely when the run changed nothing and ran no check. Never a claim that
 * this runtime started a shell.
 */
export function buildRunOutcomeFact(input: RunOutcomeMemoryInput): string {
  const body = input.learning?.trim() || input.summary.trim();
  const paths = (input.writtenPaths ?? [])
    .filter((p) => typeof p === "string" && !!p.trim())
    .slice(0, MAX_PATHS);
  const parts = [body];
  const note = recordOnlyVerifyNote(input);
  if (note) {
    parts.push(note);
  }
  if (paths.length > 0) {
    parts.push(`changed: ${paths.join(", ")}`);
  }
  return parts.join("\n");
}

/**
 * Commit what an on-prem run learned to the shared memory store, as the same
 * KIND of fact a cloud run commits.
 *
 * Returns whether the write landed, so a caller can log that — and never lets
 * `false` fail or delay its run. No-ops (rather than throwing) when this host
 * has no project id to write into: there is no project store to reach, and the
 * run still finished.
 */
export async function commitRunOutcomeMemory(
  cfg: RunOutcomeMemoryConfig | null,
  input: RunOutcomeMemoryInput,
): Promise<boolean> {
  // No project → no facts door. Skip cleanly; the run is not ours to fail.
  if (!cfg || !Number.isFinite(cfg.projectId) || cfg.projectId <= 0) {
    return false;
  }

  const key = runOutcomeFactKey(cfg, input.runId ?? "");
  // The floor measures the LEARNING, not the verify note appended below it: a
  // four-word summary teaches nothing, and a "verify skipped" line must not be
  // what pushes it over the floor.
  const body = (input.learning?.trim() || input.summary.trim());
  if (body.length < MIN_COMMIT_BODY) {
    return false;
  }
  const content = buildRunOutcomeFact(input);

  // Tags are part of the cloud twin's contract but the facts door stores no tag
  // column (RememberFactBody takes key/content/source only), so `run-outcome`
  // rides on the key instead — a fact is findable by its key either way.
  try {
    const stored = await pushProjectFact(cfg, key, content);
    if (!stored) logDebug(`[run-outcome-memory] write did not land for ${key}`);
    return stored;
  } catch (err) {
    // Best-effort by contract: the run already finished; a memory write that
    // fails is reported, never propagated.
    logDebug(`[run-outcome-memory] write failed for ${key}: ${String(err)}`);
    return false;
  }
}
