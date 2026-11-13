/**
 * An owner's handle on its sub-agents — spawn, redirect, stop, collect.
 *
 * A child is started as an ORDINARY run (the host's own `run`, the one every chat turn
 * goes through) with a lineage pointer; this module never runs a loop. It is
 * non-blocking by construction: `spawn` returns the moment the child is registered and
 * started, and the owner carries on planning, coding and orchestrating while it works.
 *
 * The child's finish reaches its owner exactly once:
 *   • to a `wait_agents` call that is waiting for it, or
 *   • otherwise into the owner's inbox (`queueRunSteering`) — read before the owner's
 *     next model turn if it is running, or, if it is idle, by a turn the host WAKES it
 *     with. An owner never has to poll.
 */

import {
  codeChangesOf,
  getRunSnapshot,
  getRunTrace,
  isModelReply,
  noteRunStep,
  queueRunSteering,
  type RunLineage,
} from "@seanhogg/builderforce-brain-embedded";
import { parseSubagentReport } from "@builderforce/agent-loop";
import {
  RUN_COMMAND_TOOL,
  WAIT_INTERRUPTED_NOTE,
  childReportText as reportText,
  clipChildOutput,
  duplicateOfLiveChild,
  ownerDirectionText as directionText,
  type StartedCommand,
} from "@builderforce/agent-tools";
import { childSettledState, realChangedFiles } from "./childDoneEvidence";
import { MAX_CHILD_DEPTH, type ChildReport, type ChildRuns } from "./childRuns";
import { createChildLedger, type ChildLedger } from "./childLedger";
import { createLiveChildrenHold, hungChildrenNote, type HeldChild } from "./liveChildrenFinish";

/** One delegation, as the spawn tools describe it. */
export interface ChildRequest {
  label: string;
  task: string;
  role: string;
  persona?: { name: string; brief: string };
  asAgent?: { ref: string; name: string };
  ticket?: string;
}

export type SpawnResult = { ok: true; handle: string; name: string; label: string } | { ok: false; error: string };

/** What an owner can do about its children. */
export interface ChildControls {
  /** Whether this owner may spawn at all (the depth cap). */
  readonly canSpawn: boolean;
  /** Start a child. Returns at once; the child works alongside the owner. */
  spawn(req: ChildRequest): SpawnResult;
  /** Redirect a running child — the text is in front of its next turn. */
  message(handle: string, text: string, from: "owner" | "person"): { ok: true } | { ok: false; error: string };
  /** Stop children by handle (`all` = every live child of this owner). Returns who was stopped. */
  stop(handles: readonly string[] | "all"): string[];
  /** Block until the named (or all live) children settle, or the timeout. */
  wait(handles: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<{ reports: ChildReport[]; running: string[]; note?: string }>;
  /** The refusal for an owner `run_command` a live child of this owner already owns
   *  (briefed to run, or started) — `duplicateOfLiveChild`; null when none does. `cwd` is the owner's `run_command` cwd. */
  runningCommand(command: string, cwd?: string): string | null;
}

/** The run a set of controls acts for. */
export interface ChildOwner {
  /** The owner's run key (its chat id for a top-level run). */
  key: number;
  /** The chat the whole tree lives in. */
  rootChatId: number;
  /** The owner's name, as the chat shows it. */
  name: string;
  /** 0 for a top-level run. */
  depth: number;
}

/** What the host lends the spawner. Every member is the host's own run machinery. */
export interface ChildRunHost {
  registry: ChildRuns;
  /** Start the child as an ordinary run. Resolves when it settles. */
  startChild(key: number, lineage: RunLineage, owner: ChildOwner, req: ChildRequest): Promise<void>;
  stop(key: number): void;
  /** Make sure an owner hears its inbox: start a turn for it if idle, or once its current
   *  run settles. False when this host cannot start one (the native participant). */
  wake(ownerKey: number): boolean;
  /** Show a direction in the chat — who said what, to which child (or, with `to` null,
   *  the person steering the chat's own run). Best-effort. */
  postDirection(rootChatId: number, from: "owner" | "person", fromName: string, to: { ref: string; name: string } | null, text: string): void;
  /** The chat's set of live children changed. */
  changed(rootChatId: number): void;
  /** Every child's brief, commands and outcome — persisted with the parent run when the
   *  host wires a `persist` port (`childRunJournal.ts`). Absent ⇒ an in-memory ledger per host. */
  ledger?: ChildLedger;
}

/** The ledger a host without one of its own shares across every owner's controls. */
const hostLedgers = new WeakMap<ChildRunHost, ChildLedger>();

function ledgerOf(host: ChildRunHost): ChildLedger {
  if (host.ledger) return host.ledger;
  let ledger = hostLedgers.get(host);
  if (!ledger) {
    ledger = createChildLedger({ startedCommands: startedCommandsOf });
    hostLedgers.set(host, ledger);
  }
  return ledger;
}

/** The `run_command` commands a child run has started, read from its trace - with the `cwd` each ran in, when it named one. */
export function startedCommandsOf(key: number): StartedCommand[] {
  return getRunTrace(key).flatMap((ev) => {
    if (ev.category !== "tool" || ev.label !== RUN_COMMAND_TOOL) return [];
    const args = ev.args as { command?: unknown; cwd?: unknown } | undefined;
    const command = args?.command;
    if (typeof command !== "string" || !command.trim()) return [];
    return [typeof args?.cwd === "string" && args.cwd.trim() ? { command, cwd: args.cwd } : command];
  });
}

/** A token that moves whenever a child run does something — a trace step or streamed text (the finish hold's progress). */
export function childProgressOf(key: number): string {
  const trace = getRunTrace(key);
  return `${trace.length}:${trace[trace.length - 1]?.ts ?? ""}:${getRunSnapshot(key).streamingText?.length ?? 0}`;
}

/** Ask the host to stop these children — the same two calls `stop_agent` makes. */
function stopChildren(host: ChildRunHost, children: ReadonlyArray<{ key: number }>): void {
  for (const child of children) {
    host.registry.requestStop(child.key);
    host.stop(child.key);
  }
}

/**
 * The owner run's live-children finish hold (`liveChildrenFinish.ts`) over this host's registry: stop-requested children
 * do not hold it, and children hung across the stalled-hold cap are stopped with a note on the owner's trace.
 */
export function ownerFinishHold(host: ChildRunHost, ownerKey: number): () => Promise<string | null> {
  return createLiveChildrenHold({
    live: () => host.registry.liveOf(ownerKey),
    stopRequested: (key) => host.registry.stopRequested(key),
    progress: childProgressOf,
    stop: (children) => stopChildren(host, children),
    released: (children: ReadonlyArray<HeldChild>, holds) =>
      noteRunStep(ownerKey, {
        label: "run.children_hold_released",
        args: { stopped: children.map((c) => c.handle), holds },
        result: hungChildrenNote(children, holds),
      }),
  });
}

export function childControls(host: ChildRunHost, owner: ChildOwner): ChildControls {
  const ledger = ledgerOf(host);
  const settle = (key: number, lineage: RunLineage, req: ChildRequest): void => {
    const stopped = host.registry.stopRequested(key);
    const report = reportOf(key, lineage, req, stopped);
    const undelivered = host.registry.settle(key, report);
    ledger.settled(key, report, undelivered ? "inbox" : "wait");
    host.changed(owner.rootChatId);
    if (!undelivered) return;
    queueRunSteering(owner.key, reportText(report));
    // A child someone asked to stop reports into the inbox (read with the owner's next turn) but never WAKES the owner:
    // its stop was a decision already made, and a wake would be a run with no ask of its own (chat #61651).
    if (stopped) return;
    // A running owner reads it before its next turn; an idle one is woken with it; one
    // whose run is just ending is woken once it has.
    host.wake(owner.key);
  };

  return {
    canSpawn: owner.depth < MAX_CHILD_DEPTH,

    spawn(req) {
      const name = req.asAgent?.name ?? req.persona?.name ?? req.label;
      const registered = host.registry.register({
        rootChatId: owner.rootChatId,
        ownerKey: owner.key,
        ownerName: owner.name,
        label: req.label,
        agent: req.asAgent ?? { ref: `subagent:${req.label}`, name },
        depth: owner.depth + 1,
        ...(req.ticket ? { ticket: req.ticket } : {}),
      });
      if ("error" in registered) return { ok: false, error: registered.error };
      const { key, lineage } = registered;
      ledger.spawned({
        key,
        ownerKey: owner.key,
        rootChatId: owner.rootChatId,
        handle: lineage.handle,
        label: lineage.label,
        owner: owner.name,
        brief: req.task,
        role: req.role,
        ...(req.ticket ? { ticket: req.ticket } : {}),
      });
      host.changed(owner.rootChatId);
      // Not awaited — the owner keeps working. A start that throws settles as failed.
      void host
        .startChild(key, lineage, owner, req)
        .catch(() => undefined)
        .finally(() => settle(key, lineage, req));
      return { ok: true, handle: lineage.handle, name: lineage.agent.name, label: lineage.label };
    },

    message(handle, text, from) {
      const child = host.registry.find(owner.key, handle);
      if (!child) return { ok: false, error: `no sub-agent '${handle}' of yours in this chat` };
      if (child.state !== "running") return { ok: false, error: `${handle} already finished (${child.state}) — spawn a new one for more work` };
      queueRunSteering(child.key, directionText(owner.name, text));
      host.postDirection(owner.rootChatId, from, owner.name, child.lineage.agent, text.trim());
      return { ok: true };
    },

    stop(handles) {
      const targets = handles === "all"
        ? host.registry.liveOf(owner.key)
        : handles.flatMap((h) => {
            const c = host.registry.find(owner.key, h);
            return c && c.state === "running" ? [{ key: c.key, handle: h }] : [];
          });
      stopChildren(host, targets);
      return targets.map((t) => t.handle);
    },

    async wait(handles, timeoutMs, signal) {
      const { reports, running, interrupted } = await host.registry.wait(owner.key, handles, timeoutMs, signal);
      return { reports, running, ...(interrupted ? { note: WAIT_INTERRUPTED_NOTE } : {}) };
    },

    runningCommand: (command, cwd) => duplicateOfLiveChild(command, ledger.liveWork(owner.key), cwd),
  };
}

/** What a settled child run reported — read from the run itself, never re-derived. */
function reportOf(key: number, lineage: RunLineage, req: ChildRequest, stopped: boolean): ChildReport {
  const snapshot = getRunSnapshot(key);
  const answer = [...snapshot.appended].reverse().find(isModelReply)?.content?.trim() ?? "";
  const files = new Set<string>();
  const trace = getRunTrace(key);
  for (const ev of trace) {
    if (ev.category !== "tool") continue;
    for (const f of codeChangesOf(ev.label, ev.args, ev.result) ?? []) files.add(f);
  }
  // "Done" requires evidence (chat #80006, R2): a child whose final reply only CLAIMS
  // completion — no real changed file, a failed check after its last edit, or a final
  // turn that asks / stalls — settles as "incomplete", with the reason in the report.
  const verdict = childSettledState({
    stopped,
    snapshotError: snapshot.error,
    answer,
    changedFiles: realChangedFiles([...files]),
    trace,
  });
  const state = verdict.state === "incomplete" ? "failed" : verdict.state;
  const output =
    verdict.state === "incomplete" && verdict.reason
      ? `${answer}\n\n—not done: ${verdict.reason}`
      : state === "failed" && !answer
        ? snapshot.error || "it stopped without a report"
        : answer;
  const { openIssues } = parseSubagentReport(answer);
  return {
    handle: lineage.handle,
    name: lineage.agent.name,
    label: lineage.label,
    state,
    output: clipChildOutput(output),
    ...(req.ticket ? { ticket: req.ticket } : {}),
    ...(files.size ? { changedFiles: [...files] } : {}),
    ...(openIssues.length ? { openIssues } : {}),
  };
}

/** The words an owner and a child read from each other — shared with the cloud runner. */
export { ownerDirectionText as directionText } from "@builderforce/agent-tools";
