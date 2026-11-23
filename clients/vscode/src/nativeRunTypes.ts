/**
 * The native chat participant's run CONTRACT - what it asks the person (`NativeApprovalRequest`), the prose the host owns
 * (`NativeRunLabels`) and how the run's output reaches the chat (`NativeRunEvents`). Types only. No `vscode` import.
 */

import type { ChatErrorAction } from "@seanhogg/builderforce-brain-embedded";

/**
 * The native surface renders MARKDOWN, not the webview's `<BrainTimeline>`, so the
 * loop's observable state has to be translated into a linear stream of calls. This is
 * the same four-event contract the participant has always consumed.
 */
export interface NativeRunEvents {
  onText(delta: string): void;
  /** A tool is RUNNING now (the run store's live step); `onToolResult` follows when it finishes. */
  onToolStart(label: string): void;
  onToolResult(label: string, ok: boolean): void;
  /**
   * The run failed. `action` is the SHARED entitlement verdict the loop already derived
   * from the gateway's structured fields (expired session / needs a plan / needs a
   * card), so the participant can offer the fix as a link instead of only restating the
   * sentence — the markdown twin of the webview's error banner.
   */
  onError(message: string, action: ChatErrorAction | null): void;
}

/** A tool call the loop paused on, waiting for an explicit human decision. */
export interface NativeApprovalRequest {
  /** Tool the model asked to run. */
  name: string;
  args: Record<string, unknown>;
  /** Human one-liner for the modal — "edit src/app.ts", "run: pnpm test". */
  label: string;
  /**
   * Set only when a GOVERNANCE gate (not the ordinary write-confirm) is what paused
   * the call, carrying the gate's reason. The host phrases those two prompts
   * differently, so the distinction has to survive to the modal.
   */
  gateReason?: string;
  /** The ship gate's evidence line for a gated publish (PRD 45 §4.5): what was verified, what could not run, who reviewed. */
  evidence?: string;
}

/** Prose the HOST owns, because it must be localized through `vscode.l10n.t()`. */
export interface NativeRunLabels {
  /** Appended when the loop stopped the run itself — its last few tool calls all failed
   *  and it had to be forced to answer (or gave up outright). */
  dispatchHint: string;
  /** Handed to the model in place of a call a governance `block` gate refused. */
  blockedByPolicy(reason: string): string;
  /** Said when the chat already has a run in flight that another path started: this turn
   *  claimed nothing, so it neither runs nor settles. Omitted ⇒ it returns silently. */
  alreadyRunning?: string;
}
