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
 * minutes): `plan` answers with the plan and a review id, `run` only starts it, and its
 * progress and report arrive as events.
 *
 * Types only, plus the frame names: no `vscode`, no React.
 */

import type { KnowledgeGraph, ReviewPlan, ReviewProgress, ReviewReport } from "@seanhogg/builderforce-memory/knowledge";

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
  | { op: "targets" }
  | { op: "plan"; req: KnowledgeReviewRequest }
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
  | { op: "takeFocus" };

export type KnowledgeOp = KnowledgeCall["op"];

export interface KnowledgeScopeRow {
  rootId: string;
  title: string;
  packs: string[];
  lastReviewedAt?: string;
}

export interface KnowledgeTargetRow {
  id: string;
  kind: "workspace" | "folder";
  title?: string;
}

/** What `plan` answers: the plan to confirm, or nothing picked. */
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
  | { stream: string; type: "progress"; progress: ReviewProgress }
  | { stream: string; type: "done"; rootId: string; report: ReviewReport }
  | { stream: string; type: "failed"; error: string }
  | { stream: string; type: "graph"; graph: KnowledgeGraph; changed: string[] };
