/**
 * The knowledge view's bridge vocabulary — ONE declaration for the host
 * (`knowledgeBridge.ts`) and the webview (`webview/src/knowledgeGraph/
 * hostKnowledgeGraphSource.ts`), like `bridgeProtocol.ts`.
 *
 *   webview → host  `knowledge.call` (request/response) with one {@link KnowledgeCall};
 *   host → webview  `knowledge.event` — a review's progress / end, or a live graph, keyed
 *                   by the `stream` the webview opened it with;
 *                   `knowledge.focus` — open the Knowledge view on these refs
 *                   (`builderforce.openKnowledgeGraph`).
 *
 * A review never rides one long request (a request times out; a review can take
 * minutes, and so can planning a big folder or leaving the folder picker open): `plan`
 * answers at once and the plan arrives as a `planned` event on the stream the webview
 * opened, `run` only starts the review, and its progress and report arrive as events.
 *
 * Types only, plus the frame names: no `vscode`, no React.
 */

import type { PinpointMatchResult, ReplicaState } from "@builderforce/agent-tools/knowledge";
import type { CallSite, Finding, KnowledgeGraph, ReviewPlan, ReviewFailure, ReviewProgress, ReviewReport, ReviewRun } from "@seanhogg/builderforce-memory/knowledge";

export const KNOWLEDGE_CALL = "knowledge.call";
export const KNOWLEDGE_EVENT = "knowledge.event";
export const KNOWLEDGE_FOCUS = "knowledge.focus";

/** The view's review request (the view package's `ReviewRequest`, restated for the host). */
export interface KnowledgeReviewRequest {
  rootId?: string;
  target?: string;
  pick?: boolean;
  force?: boolean;
  /** "Use the server's copy": a local review with a server read-through (PRD 41 A7). */
  seed?: boolean;
  /** Retry (PRD 41 A8): these files failed before; they are owed a review again, then the normal plan and confirm. */
  retry?: string[];
}

/**
 * `load`'s answer when this machine holds no review of the root (PRD 41 A7): the view says "Not
 * reviewed on this machine" and offers Review, plus the server's copy when `canSeed` (linked and
 * allowed to reach the project). Restated by the view package as `NotReviewedHere`.
 */
export interface KnowledgeNotReviewedHere { notReviewedHere: { canSeed: boolean } }

export type KnowledgeCall =
  | { op: "scopes" }
  | { op: "load"; rootId: string; focus?: string[]; maxNodes?: number }
  | { op: "lastSeen" }
  | { op: "targets" }
  | { op: "plan"; req: KnowledgeReviewRequest; stream: string }
  | { op: "run"; reviewId: string }
  | { op: "stop"; reviewId: string }
  | { op: "discard"; reviewId: string }
  | { op: "search"; rootId: string; q: string }
  | { op: "live"; rootId: string; stream: string }
  | { op: "unlive"; stream: string }
  | { op: "remember"; rootId: string; ref: string; content: string }
  | { op: "factActions"; ref: string }
  | { op: "deleteFact"; ref: string }
  | { op: "baseline"; rootId: string }
  | { op: "compose"; text: string }
  | { op: "takeFocus" }
  // The screenshot rides as a base64 data URL (a Blob does not survive postMessage reliably).
  | { op: "pinpoint"; rootId: string; image: string }
  | { op: "history"; rootId: string }
  | { op: "syncStatus"; rootId: string }
  // Retry upload: forget the root's recorded upload failures and drain its replica queue now (answers null once the pump has started; the sync status follows the upload).
  | { op: "retrySync"; rootId: string }
  | { op: "applyFix"; rootId: string; finding: Finding }
  // The staged fix flow: one of the four checks (build, types, lint, tests) through the project's own script, and undo of an applied fix.
  | { op: "runFixCheck"; rootId: string; check: string; finding: Finding }
  | { op: "previewFix"; rootId: string; finding: Finding }
  // Undo names only the fix the host recorded; never paths.
  | { op: "undoFix"; rootId: string; fixId: string }
  | { op: "cancelFixCheck"; rootId: string }
  // The API drawer's sandbox Send: the extension performs it (no webview CORS), localhost / dev origins only.
  | { op: "tryRequest"; req: KnowledgeTryRequest }
  // The map's class and function levels: the definitions in some files of a root (read from disk, capped; never stored in the graph).
  // The host treats `fileRefs` as untrusted (validated, capped and path-checked in knowledgeSymbols.ts).
  // If `untrustedWorkspaces` is ever declared `limited` in package.json, gate `symbols`, `history` and `pinpoint`
  // (they read the workspace's files or run git in it) on `vscode.workspace.isTrusted`, as the fix flow does.
  | { op: "symbols"; rootId: string; fileRefs: string[] }
  // The review's run record (PRD 41 A8): a root's recent runs (light), one whole run, and Stop by run id.
  // A retry of failed files is not an op: it is a normal review request (`KnowledgeReviewRequest.retry`).
  | { op: "runs"; rootId: string }
  | { op: "runRecord"; runId: string }
  | { op: "stopRun"; runId: string }
  // Exclude from review (PRD 41 A9): appends `path/` to the root's `.builderforce/ignore`. It writes that file only; the view then runs its normal Re-review (plan, estimate, confirm). Refused while a review of the root runs.
  | { op: "excludeFromReview"; rootId: string; path: string }
  // Agent-run findings (PRD 46 §3.4): the recent local chats that ran tools, and one run's report.
  | { op: "agentRuns" }
  | { op: "agentRunReport"; id: string; rootId?: string }
  // First-load triage: the timings of the recent scopes / lastSeen / load / baseline / syncStatus calls and the phase a load is in now.
  | { op: "loadTrace" };

/** One phase of a traced call (`partitions`, `index`, `nearDuplicates`, `build`, `pack`, `server`, `notHere`) and how long it took. */
export interface KnowledgeLoadPhase { phase: string; ms: number }

/** One finished call the host timed (`knowledgeLoadTrace.ts`). The view restates this as `LoadTraceEntry`. */
export interface KnowledgeLoadTraceEntry {
  op: string;
  rootId?: string;
  /** Epoch ms. */
  startedAt: number;
  durationMs: number;
  /** `null`: the call answered nothing (a miss, no review). */
  outcome: "ok" | "null" | "error";
  error?: string;
  phases: KnowledgeLoadPhase[];
  /** What answered a `load` (`local`, `pack`, `server`, `not-here`). */
  via?: string;
  nodes?: number;
  edges?: number;
  sources?: number;
  truncated?: boolean;
  focus?: boolean;
  maxNodes?: number;
  /** Rows answered (scopes). */
  count?: number;
  /** Near-duplicate pairs the index handed the build. */
  nearDuplicates?: number;
  hostLag?: KnowledgeHostLag;
}

/** A call still running: the phases it is in now (a load reads partitions and the index at once). */
export interface KnowledgeLoadInFlight {
  op: string;
  rootId?: string;
  startedAt: number;
  phases: { phase: string; startedAt: number }[];
  hostLag?: KnowledgeHostLag;
}

/** `loadTrace`'s answer: the latest finished calls (oldest first), the running ones, and the host's clock. The view restates this as `LoadTrace`. */
export interface KnowledgeLoadTrace { now: number; entries: KnowledgeLoadTraceEntry[]; inFlight: KnowledgeLoadInFlight[] }

/** How a run ended; `interrupted` is the host's own word for a record left `running` by a window that closed. */
export type KnowledgeRunOutcome = NonNullable<ReviewRun["outcome"]> | "interrupted";

/**
 * A review run as the host records it: memory's {@link ReviewRun} plus where the replica queue stood
 * when it ended (linked roots), whether parallel extraction was down, and, on a live `run` event, the
 * count of all failures when `failures` holds only the latest (`runRecord` returns them all).
 * The view restates this as `StoredReviewRun`.
 */
/** How long the extension host's event loop was blocked during the run (ms): a stall here is why steps overran their deadlines. */
export interface KnowledgeHostLag { maxMs: number; p99Ms: number; meanMs: number }

export type KnowledgeStoredRun = Omit<ReviewRun, "outcome" | "failures"> & {
  outcome?: KnowledgeRunOutcome;
  /** Every failure, oldest first (memory's run keeps them in chunks; the record, the wire and the file carry them flat). */
  failures: ReviewFailure[];
  replica?: ReplicaState;
  /** Why the extraction pool was unavailable (the run extracted on one thread); absent ⇒ it was not. */
  poolDown?: string;
  /** Event-loop stall sampled during the run; absent on older records. */
  hostLag?: KnowledgeHostLag;
  /** The slowest save of this run's record to disk (ms). */
  saveMsMax?: number;
  failureCount?: number;
  /** Files owed judgement when the map was completed; the host sets it at `mapped`. */
  awaitingJudgeTotal?: number;
};

/** A run without its steps, lanes and failures: what the history list needs. */
export type KnowledgeRunSummary = Omit<KnowledgeStoredRun, "steps" | "lanes" | "failures"> & { failureCount: number };

/** One definition, as the view's `SymbolRecord` (restated: the host cannot import that package). */
export interface KnowledgeSymbolRecord {
  ref: string; name: string; kind: string; parent: string; line: number; exported: boolean;
  /** The symbol-level edges that START at this definition (PRD 43 P0b); absent when it has none. */
  relations?: KnowledgeSymbolRelation[];
}

/**
 * One symbol-level edge (memory's `SYMBOL_EDGE_KINDS`: extends · implements · composes · uses · calls). `to` is, in order:
 *   - the exact `ref` of a record in the same answer (`<file ref>#<Container.>name@<line>`);
 *   - `<file ref>#<Container.>name` (no `@line`) for a definition in a file of the root this answer did not load — the view
 *     matches it by file ref + qualified name once that file's records arrive;
 *   - `src:<root>::node_modules/<package>#<name>` for a package, or the as-written path for a relative import the root does not
 *     hold: no file, so the view draws it as a `missing` terminus.
 * `sites` (calls only): every call site, `order` = its position among ALL calls in the caller's body.
 */
export interface KnowledgeSymbolRelation {
  kind: string;
  to: string;
  sites?: CallSite[];
}

/** The view's `TryRequest` / `TryResponse`, restated for the host (it cannot import that package). */
export interface KnowledgeTryRequest { method: string; url: string; headers?: Record<string, string>; body?: string }
export interface KnowledgeTryResponse { status: number; headers: Record<string, string>; body: string; ms: number; truncated?: boolean }

/** The view's `PinpointResult` is this shape: the matching core's own result type. */
export type KnowledgePinpointResult = PinpointMatchResult;

export interface KnowledgeHistoryResult {
  commits: { sha: string; title: string; at: string; refs: string[]; author?: string }[];
}

/**
 * Counts of a root. `edges` is absent when this host did not measure it (a linked editor keeps
 * no local graph); `truncated` when the platform graph's own cap cut the count short.
 *
 * The view's `SyncStatus` (`knowledge-graph-view` `types.ts`) needs the same four changes: `local.edges?`,
 * `skipped?` (absent = no list recorded, "unknown"), `skipped[].bytes?` and `truncated?` on the counts.
 * The extension host cannot import that package, so the shape is restated here.
 */
export interface KnowledgeSyncCounts { files: number; edges?: number; docs: number; truncated?: boolean }

export interface KnowledgeSyncSkipped { path: string; bytes?: number; reason: string }

export interface KnowledgeSyncStatus {
  local: KnowledgeSyncCounts;
  server?: KnowledgeSyncCounts;
  /** The replica queue's state (PRD 41 A7); present when the root is linked. */
  replica?: ReplicaState;
  /** Absent when no review has recorded a list: "unknown", not "none". */
  skipped?: KnowledgeSyncSkipped[];
  sources: {
    id: "code" | "docs" | "coverage" | "usage" | "traces" | "openapi" | "history" | "owners";
    state: "collected" | "estimated" | "absent";
    note?: string;
  }[];
}

/** One file of a fix preview: what the codemod would remove (knip's own report), as lines when it names them. */
export interface FixPreviewRow { path: string; removed?: number; added?: number; lines?: string[] }
export interface KnowledgeFixPreview { files: FixPreviewRow[] }

/** One check of a fix: skipped when the project has no script for it. */
export interface KnowledgeCheckReply { status: "pass" | "fail" | "skipped"; detail?: string }

export interface KnowledgeFixResult {
  branch?: string;
  /** What undo takes: the host recorded what this fix wrote. Absent when the host could not record it. */
  fixId?: string;
  /** Why no branch was made (git refused), when the fix applied in place instead. */
  branchError?: string;
  /** The finding's files the fix changed. */
  changed: string[];
  /** Files the person saved during the run that the fix also changed: left as they are, to be checked. */
  conflicts?: string[];
}

export type KnowledgeOp = KnowledgeCall["op"];

export interface KnowledgeScopeRow {
  rootId: string;
  title: string;
  packs: string[];
  lastReviewedAt?: string;
  /** A loaded knowledge pack (PRD 40): browsable, never reviewed or written. */
  readOnly?: true;
  /** Listed from the project, held by no folder here: drawn from the server's graph, read-only (PRD 41 A7 rule 3). */
  serverOnly?: true;
  /** The pack's name, when the row is one. */
  pack?: string;
}

export interface KnowledgeTargetRow {
  id: string;
  kind: "workspace" | "folder";
  title?: string;
}

/** What the `planned` event carries: the plan to confirm, or nothing picked. */
export type KnowledgePlanReply = { reviewId: string; rootId: string; plan: ReviewPlan } | { cancelled: true };

export interface KnowledgeFocusFrame {
  focus: string[];
  rootId?: string;
}

/** The `knowledge.event` frame: the event rides WRAPPED (its own `type` is not the frame's). */
export interface KnowledgeEventFrame {
  event: KnowledgeEvent;
}

/** A host → webview event on one stream (a review id, or a live subscription id). */
export type KnowledgeEvent =
  | { stream: string; type: "planned"; reply: KnowledgePlanReply }
  | { stream: string; type: "progress"; progress: ReviewProgress }
  // The run record of the review on this stream, at most 10 a second; the last one is always sent.
  | { stream: string; type: "run"; run: KnowledgeStoredRun }
  | { stream: string; type: "done"; rootId: string; report: ReviewReport; skipped?: KnowledgeSyncSkipped[] }
  // `error` is the reason shown to the person; the rest is the diagnostic detail the view's
  // *Copy details* carries (the stack, the extension build, the folder) — all logged host-side too.
  | { stream: string; type: "failed"; error: string; detail?: string; host?: string; rootPath?: string }
  | { stream: string; type: "graph"; graph: KnowledgeGraph; changed: string[] };
