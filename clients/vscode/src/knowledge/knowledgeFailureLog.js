/**
 * A failed knowledge review, written to the BuilderForce output channel (the extension's
 * ONE log surface, `errorReporter.ts`) and shaped for the view: before this the view saw a
 * message and the channel saw nothing, so a failed review could not be diagnosed.
 *
 * Pure over a `log` sink (no `vscode`), so it is tested without the editor.
 */
/** The failure's text: its stack when it has one, else its message. */
const detailOf = (error) => (error instanceof Error ? error.stack ?? error.message : String(error));
/** Logs the failure (timestamp, root, review, phase, message, stack) and returns what the view is sent. */
export function logReviewFailure(sink, ctx, error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = detailOf(error);
    const at = (sink.now?.() ?? new Date()).toISOString();
    sink.log([
        `[${at}] knowledge ${ctx.stage} failed`,
        `  root: ${ctx.rootId ?? "(none)"}${ctx.rootPath ? ` (${ctx.rootPath})` : ""}`,
        `  review: ${ctx.reviewId ?? "(none)"}`,
        `  phase: ${ctx.lastPhase ?? "(none)"}`,
        `  message: ${message}`,
        ...detail.split("\n").map((line) => `  ${line}`),
    ].join("\n"));
    return { error: message, detail, host: sink.host, ...(ctx.rootPath ? { rootPath: ctx.rootPath } : {}) };
}
//# sourceMappingURL=knowledgeFailureLog.js.map