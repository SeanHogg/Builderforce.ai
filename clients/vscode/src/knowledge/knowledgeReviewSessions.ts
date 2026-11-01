/**
 * The Knowledge view's reviews, held in the extension host between the plan and the run
 * (the view's confirm handshake, `knowledgeProtocol.ts`):
 *
 *   planOver(req, stream) — which folder (a known root, a workspace folder, or the folder
 *                picker), then `planReview` — no writes; the session waits under a review
 *                id. Returns at once: the outcome is posted as `planned` / `failed` on the
 *                caller's stream, since planning can outlive any request timeout;
 *   start(id)  — the person confirmed: the review runs on that plan, its progress and its
 *                report posted as events on the id's stream;
 *   stop(id)   — Stop: the review aborts between files (what was written stays);
 *   discard(id)— Cancel: nothing was written, the session is dropped.
 */

import * as vscode from "vscode";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { logLine } from "../errorReporter";
import { logReviewFailure } from "./knowledgeFailureLog";
import type { KnowledgeEvent, KnowledgePlanReply, KnowledgeReviewRequest } from "./knowledgeProtocol";
import { rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { reviewRoot, workspaceFolders, type RootReview } from "./knowledgeService";

interface Session {
  review: RootReview;
  plan: PlanDetail;
  force: boolean;
  abort?: AbortController;
  /** The phase last reported, for the failure log. */
  lastPhase?: string;
}

let nextReview = 0;

/** A plan failure already logged; carries what the view is sent. */
class PlanFailure extends Error {
  constructor(readonly sent: ReturnType<typeof logReviewFailure>) {
    super(sent.error);
  }
}

/** The folder a review request names: a known root, a target, the picker, else the first workspace folder. */
export async function reviewRootFor(req: KnowledgeReviewRequest): Promise<KnowledgeRoot | undefined> {
  const folders = workspaceFolders();
  const named = req.rootId ?? req.target;
  if (named) return rootById(named, folders);
  if (!req.pick) return folders[0] ? rootForPath(folders[0].path, folders) : undefined;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t("Review with BuilderForce"),
    ...(folders[0] ? { defaultUri: vscode.Uri.file(folders[0].path) } : {}),
  });
  const uri = picked?.[0];
  if (!uri) return undefined;
  const root = rootForPath(uri.fsPath, folders);
  if (!root) void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce reviews folders inside the open workspace."));
  return root;
}

export class KnowledgeReviewSessions implements vscode.Disposable {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly post: (event: KnowledgeEvent) => void,
    /** The extension build the failure log and the view's Copy details name. */
    private readonly hostLabel: string,
  ) {}

  private get sink() {
    return { log: logLine, host: this.hostLabel };
  }

  /** Plans in the background; the outcome is an event on `stream`, never a rejection. */
  planOver(req: KnowledgeReviewRequest, stream: string): void {
    this.plan(req).then(
      (reply) => this.post({ stream, type: "planned", reply }),
      (error: unknown) => this.post({ stream, type: "failed", ...this.planFailure(error) }),
    ).catch(() => undefined);
  }

  /** What the view is sent for a failed plan; a failure past the logged one (the picker) is logged here. */
  private planFailure(error: unknown) {
    return error instanceof PlanFailure ? error.sent : logReviewFailure(this.sink, { stage: "plan" }, error);
  }

  private async plan(req: KnowledgeReviewRequest): Promise<KnowledgePlanReply> {
    const root = await reviewRootFor(req);
    if (!root) return { cancelled: true };
    const force = !!req.force;
    let review: RootReview;
    let plan: PlanDetail;
    try {
      review = reviewRoot(this.secrets, root);
      plan = await review.plan(force);
    } catch (error) {
      throw new PlanFailure(logReviewFailure(this.sink, { stage: "plan", rootId: root.rootId, rootPath: root.rootPath }, error));
    }
    const reviewId = `review-${++nextReview}`;
    this.sessions.set(reviewId, { review, plan, force });
    return { reviewId, rootId: root.rootId, plan: plan.plan };
  }

  /** Starts a planned review; false when the id is unknown (already run or discarded). */
  start(reviewId: string): boolean {
    const session = this.sessions.get(reviewId);
    if (!session || session.abort) return false;
    const abort = new AbortController();
    session.abort = abort;
    const { rootId, rootPath } = session.review.open.root;
    void session.review
      .run({
        force: session.force,
        plan: session.plan,
        signal: abort.signal,
        onProgress: (progress) => {
          session.lastPhase = progress.phase;
          this.post({ stream: reviewId, type: "progress", progress });
        },
      })
      .then(
        (report) => this.post({ stream: reviewId, type: "done", rootId, report }),
        (error: unknown) => this.post({
          stream: reviewId,
          type: "failed",
          ...logReviewFailure(
            this.sink,
            { stage: "review", reviewId, rootId, rootPath, ...(session.lastPhase ? { lastPhase: session.lastPhase } : {}) },
            error,
          ),
        }),
      )
      .finally(() => this.sessions.delete(reviewId));
    return true;
  }

  stop(reviewId: string): void {
    this.sessions.get(reviewId)?.abort?.abort();
  }

  discard(reviewId: string): void {
    const session = this.sessions.get(reviewId);
    if (session && !session.abort) this.sessions.delete(reviewId);
  }

  /** The panel closed: planned reviews are dropped; a running one finishes (it is writing memory). */
  dispose(): void {
    for (const [id, session] of this.sessions) if (!session.abort) this.sessions.delete(id);
  }
}
