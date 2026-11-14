/**
 * The VIEW types of the run list's "Interrupted" rows (G22) — what the host sends as `run.interrupted` and the webview
 * renders and resumes from (`interruptedRunsView.ts` builds them, `interruptedResumeTurn.ts` turns one into the
 * continuation turn).
 *
 * Pure DATA, no imports: the webview type-imports this module, so nothing of the extension host (the journal, the run
 * store, the guard packages) enters the webview's type graph through it. The host side asserts its own types still fit
 * these shapes (`interruptedRunsView.ts`), so the two cannot drift apart silently.
 */
export {};
//# sourceMappingURL=interruptedRunTypes.js.map