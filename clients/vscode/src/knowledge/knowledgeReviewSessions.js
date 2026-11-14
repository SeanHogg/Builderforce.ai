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
import { logLine } from "../errorReporter";
import { logReviewFailure } from "./knowledgeFailureLog";
import { rootById, rootForPath } from "./knowledgeRoots";
import { log, reviewRoot, workspaceFolders } from "./knowledgeService";
import { reviewRecords } from "./knowledgeSyncStatus";
import { duringReview, isRootReviewing, replicaStatusOf } from "./knowledgeReplica";
import { extractPoolDown, prewarmExtractPool } from "./review/extractPoolHost";
import { throttledEmit } from "./review/throttledEmit";
import { markOwed } from "./review/retryOwed";
import { preemptBackground } from "./indexLevels";
import { onTheWireReport } from "./review/reviewRunRecorder";
import { stopRunById, trackRun } from "./review/reviewRuns";
let nextReview = 0;
/** The folder a review request names: a known root, a target, the picker, else the first workspace folder. */
export async function reviewRootFor(req) {
    const folders = workspaceFolders();
    const named = req.rootId ?? req.target;
    if (named)
        return rootById(named, folders);
    if (!req.pick)
        return folders[0] ? rootForPath(folders[0].path, folders) : undefined;
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t("Review with BuilderForce"),
        ...(folders[0] ? { defaultUri: vscode.Uri.file(folders[0].path) } : {}),
    });
    const uri = picked?.[0];
    if (!uri)
        return undefined;
    const root = rootForPath(uri.fsPath, folders);
    if (!root)
        void vscode.window.showWarningMessage(vscode.l10n.t("BuilderForce reviews folders inside the open workspace."));
    return root;
}
export class KnowledgeReviewSessions {
    secrets;
    post;
    hostLabel;
    sessions = new Map();
    disposed = false;
    constructor(secrets, post, 
    /** The extension build the failure log and the view's Copy details name. */
    hostLabel) {
        this.secrets = secrets;
        this.post = post;
        this.hostLabel = hostLabel;
    }
    get sink() {
        return { log: logLine, host: this.hostLabel };
    }
    /**
     * Plans in the background; the outcome is an event on `stream`, never a rejection. A plan that
     * lands after `dispose()` is neither stored nor posted: the panel it was for is gone.
     */
    planOver(req, stream) {
        void this.planAndPost(req, stream).catch(() => undefined);
    }
    async planAndPost(req, stream) {
        let root;
        let event;
        try {
            root = await reviewRootFor(req);
            if (!root) {
                event = { stream, type: "planned", reply: { cancelled: true } };
            }
            else {
                const force = !!req.force;
                let plan;
                const review = reviewRoot(this.secrets, root, { seed: !!req.seed });
                if (req.retry?.length) {
                    // Retry (PRD 41 A8): the failed files are owed a review, then it is the normal plan and confirm. Never while one is running.
                    // The check and the hold are one synchronous step, so no review (this panel's, a pre-fetch, a pack review, a closed
                    // panel's) starts between them; the owed marks and the plan are written inside the hold. A background indexer pass
                    // is not "a review running": it is stopped first (it reruns after) and held off until this hold is taken, so only the
                    // person's own reviews refuse.
                    const release = await preemptBackground(root.rootId);
                    try {
                        if (isRootReviewing(root.rootId))
                            throw new Error(vscode.l10n.t("A review of this folder is already running."));
                        const retry = req.retry;
                        const rootId = root.rootId;
                        plan = await duringReview(rootId, review.open.files, undefined, async () => {
                            release();
                            await markOwed(review.open.manifest, rootId, retry);
                            return review.plan(force);
                        });
                    }
                    finally {
                        release();
                    }
                }
                else {
                    plan = await review.plan(force);
                }
                const reviewId = `review-${++nextReview}`;
                if (!this.disposed)
                    this.sessions.set(reviewId, { review, plan, force, seed: !!req.seed });
                event = { stream, type: "planned", reply: { reviewId, rootId: root.rootId, plan: plan.plan } };
            }
        }
        catch (error) {
            const where = root ? { stage: "plan", rootId: root.rootId, rootPath: root.rootPath } : { stage: "plan" };
            event = { stream, type: "failed", ...logReviewFailure(this.sink, where, error) };
        }
        if (!this.disposed)
            this.post(event);
    }
    /** Starts a planned review; false when the id is unknown (already run or discarded). */
    start(reviewId) {
        const session = this.sessions.get(reviewId);
        if (!session || session.abort)
            return false;
        const abort = new AbortController();
        session.abort = abort;
        prewarmExtractPool(); // the plan is confirmed: the workers load while the review starts
        // Progress posts at most 10 a second, latest wins (PRD 41 A10 rule 8), like the run recorder.
        let latest;
        const progressPost = throttledEmit(() => { if (latest)
            this.post({ stream: reviewId, type: "progress", progress: latest }); });
        const { rootId, rootPath } = session.review.open.root;
        const { files, pump } = session.review.open;
        // The run record (PRD 41 A8): folded from the review's progress and steps, posted throttled, kept on disk at the end.
        const run = trackRun({
            rootId,
            request: { force: session.force, seed: !!session.seed },
            files,
            abort,
            post: (record) => this.post({ stream: reviewId, type: "run", run: record }),
            replica: async () => (pump ? replicaStatusOf(rootId, files) : undefined),
            poolDown: extractPoolDown,
            onSaveError: (error) => log("run record", error),
        });
        void session.review
            .run({
            force: session.force,
            plan: session.plan,
            signal: abort.signal,
            onProgress: (progress) => {
                session.lastPhase = progress.phase;
                latest = progress;
                progressPost.emit();
                run.progress(progress);
            },
            onStep: run.step,
        })
            .then(async (report) => {
            await run.finish(report.aborted ? "stopped" : "done", report);
            // What this review left out, from its record (the plan, folders, coverage, uploads).
            const skipped = reviewRecords.get(rootId)?.skipped;
            this.post({ stream: reviewId, type: "done", rootId, report: onTheWireReport(report), ...(skipped ? { skipped } : {}) });
        }, async (error) => {
            await run.finish(abort.signal.aborted ? "stopped" : "failed");
            this.post({
                stream: reviewId,
                type: "failed",
                ...logReviewFailure(this.sink, { stage: "review", reviewId, rootId, rootPath, ...(session.lastPhase ? { lastPhase: session.lastPhase } : {}) }, error),
            });
        })
            .finally(() => { progressPost.cancel(); this.sessions.delete(reviewId); });
        return true;
    }
    stop(reviewId) {
        this.sessions.get(reviewId)?.abort?.abort();
    }
    /** Stop by run id, process-wide (a run another panel, a closed one or a Retry started). */
    stopRun(runId) {
        stopRunById(runId);
    }
    discard(reviewId) {
        const session = this.sessions.get(reviewId);
        if (session && !session.abort)
            this.sessions.delete(reviewId);
    }
    /** The panel closed: planned reviews are dropped; a running one finishes (it is writing memory). */
    dispose() {
        this.disposed = true;
        for (const [id, session] of this.sessions)
            if (!session.abort)
                this.sessions.delete(id);
    }
}
//# sourceMappingURL=knowledgeReviewSessions.js.map