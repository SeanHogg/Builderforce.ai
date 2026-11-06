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

import type { PinpointMatchResult } from "@builderforce/agent-tools/knowledge";
import type { Finding, KnowledgeGraph, ReviewPlan, ReviewProgress, ReviewReport } from "@seanhogg/builderforce-memory/knowledge";

export const KNOWLEDGE_CALL = "knowledge.call";
export const KNOWLEDGE_EVENT = "knowledge.event";
export const KNOWLEDGE_FOCUS = "knowledge.focus";

/** The view's review request (the view package's `ReviewRequest`, restated for the host). */
export interface KnowledgeReviewRequest {
  rootId?: string;
  target?: string;
  pick?: boolean;
  force?: boolean;
}

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
  | { op: "applyFix"; rootId: string; finding: Finding }
  // The API drawer's sandbox Send: the extension performs it (no webview CORS), localhost / dev origins only.


/** The view's `PinpointResult` is this shape: the matching core's own result type. */
export type KnowledgePinpointResult = PinpointMatchResult;

export interface KnowledgeHistoryResult {
  commits: { sha: string; title: string; at: string; refs: string[] }[];
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
  /** Absent when no review has recorded a list: "unknown", not "none". */
  skipped?: KnowledgeSyncSkipped[];
  sources: {
    id: "code" | "docs" | "coverage" | "usage" | "traces" | "openapi" | "history" | "owners";
    state: "collected" | "estimated" | "absent";
    note?: string;
  }[];
}

export interface KnowledgeFixResult {
  branch?: string;
  /** The finding's files knip changed. */
  changed: string[];
  /** Files the person saved during the run that knip also changed: left as they are, to be checked. */
  conflicts?: string[];
  /** What the fix did beyond the named export: knip fixes the whole file. */
  note?: string;
}

export type KnowledgeOp = KnowledgeCall["op"];

export interface KnowledgeScopeRow {
  rootId: string;
  title: string;
  packs: string[];
  lastReviewedAt?: string;
  /** A loaded knowledge pack (PRD 40): browsable, never reviewed or written. */
  readOnly?: true;
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
  | { stream: string; type: "done"; rootId: string; report: ReviewReport; skipped?: KnowledgeSyncSkipped[] }
  // `error` is the reason shown to the person; the rest is the diagnostic detail the view's
  // *Copy details* carries (the stack, the extension build, the folder) — all logged host-side too.
  | { stream: string; type: "failed"; error: string; detail?: string; host?: string; rootPath?: string }
  | { stream: string; type: "graph"; graph: KnowledgeGraph; changed: string[] };
