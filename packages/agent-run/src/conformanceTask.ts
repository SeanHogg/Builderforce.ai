/**
 * conformanceTask — the ONE scripted task every entry point is held to (PRD 35 §3.3 "Conformance suite").
 *
 * The same prompt, the same fake-model script and the same expected trace and answer are imported by the
 * conformance case of every adapter — each lives beside the adapter it drives (a package can only load its own
 * dependencies), so the task cannot be restated per package: a restated script would let one adapter drift from
 * another without any test noticing. A surface supplies PORTS; this is what the run must then do with them.
 *
 * `conformanceTrace` folds a run's {@link RunEvent}s to the facts that are the same on every surface (the order
 * of events, the model that answered, the tool that ran and whether it did) and leaves out what a surface
 * legitimately measures differently (steps, token counts, the size of its tool catalog).
 *
 * Plain data and one pure function: no `node:*`, no DOM, no test runner.
 */

import type { Capability, CapabilityProvider } from "@builderforce/agent-tools";
import type { EventSink, ModelCompletion } from "./contract.js";
import type { RunEvent } from "./runEvents.js";

/** What the person asks. */
export const CONFORMANCE_PROMPT = "List the files, then say hello.";

/** What the run must end with: the model's closing prose (a run with no tool calls in its last turn is finished). */
export const CONFORMANCE_ANSWER = "Hello! Done.";

/** The model id the fake model reports. */
export const CONFORMANCE_MODEL = "fake-model";

/**
 * The one tool every entry point has. A registry surface (cloud, on-prem tickets, the Brain) backs it with a `repo.read`
 * capability; a surface whose catalog is its own (channels, the canvas) offers a tool of this name. It answers an empty listing.
 */
export const CONFORMANCE_TOOL = "list_files";

/** A registry surface's backing for {@link CONFORMANCE_TOOL}: a read-only workspace that lists nothing. */
export function conformanceCapabilities(): CapabilityProvider {
  return {
    capabilities: new Set<Capability>(["repo.read"]),
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [] }),
      readFile: async (path: string) => ({ ok: false, path, error: "not found" }),
      searchCode: async (query: string) => ({ ok: true, query, total: 0, matches: [] }),
    },
  };
}

/** The fake model's answers, in order: one call of {@link CONFORMANCE_TOOL}, then the closing prose. No `finish`: most surfaces have none. */
export const CONFORMANCE_SCRIPT: readonly ModelCompletion[] = [
  { content: "", toolCalls: [{ id: "call-1", name: CONFORMANCE_TOOL, arguments: "{}" }], model: CONFORMANCE_MODEL },
  { content: CONFORMANCE_ANSWER, model: CONFORMANCE_MODEL },
];

/**
 * The trace every entry point emits for the scripted task, in order: the ONE golden. A surface that differs from it for a real reason
 * pins the difference in its own case with a comment saying why; there is no second golden.
 * Pinned and proved by `test/conformance/crossAdapter.test.ts`.
 */
export const CONFORMANCE_TRACE: readonly string[] = [
  "run.started",
  "model.preflight",
  "turn.started",
  "context.tools",
  "model.completed:fake-model",
  "tool.dispatched:list_files:ok",
  "turn.finished",
  "turn.started",
  "model.completed:fake-model",
  "run.finished:finished",
];

/** One event as the fact every surface agrees on. */
export function conformanceFact(event: RunEvent): string {
  switch (event.kind) {
    case "model.completed":
      return `model.completed:${event.model ?? ""}`;
    case "tool.dispatched":
      return `tool.dispatched:${event.tool}:${event.ok ? "ok" : "error"}`;
    case "run.finished":
      return `run.finished:${event.outcome}`;
    default:
      return event.kind;
  }
}

/** A run's trace folded to the facts that must be identical on every entry point. */
export function conformanceTrace(events: readonly RunEvent[]): string[] {
  return events.map(conformanceFact);
}

/**
 * An event sink that also copies every event into `into`, so a test can read the trace of a run an ADAPTER built
 * the ports for. It forwards to `sink` unchanged — it observes the adapter's own sink, it does not replace it.
 */
export function teeEvents(sink: EventSink | undefined, into: RunEvent[]): EventSink {
  return {
    emit: (event, meta) => {
      into.push(event);
      return sink?.emit(event, meta);
    },
    ...(sink?.outcome ? { outcome: (row) => sink.outcome?.(row) } : {}),
  };
}
