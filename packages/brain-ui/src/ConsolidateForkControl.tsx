/**
 * ConsolidateForkControl — the shared "compress this chat / branch it into a new
 * one" control, rendered identically on the web Brain composer and inside the VS
 * Code webview (which historically hand-rolled the same two buttons).
 *
 * Presentational only: it renders two buttons and calls back. The host owns the
 * actual consolidation/fork logic (summarize the chat, append the consolidation
 * marker, or create + seed a forked chat) and the busy/enabled state. Colors come
 * exclusively from theme CSS variables (with layered fallbacks) so the SAME markup
 * reads correctly in the web app's light/dark themes and the VS Code editor theme —
 * no hardcoded hex that only works in one theme.
 */

import type { CSSProperties } from 'react';

/* Consolidate = collapse the conversation inward into a compact summary.
   (SVG copied verbatim from clients/vscode/webview/src/App.tsx IconConsolidate.) */
const IconConsolidate = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.5 4.5 8 2 10.5M14 5.5 11.5 8 14 10.5M6.5 3v10M9.5 3v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/* Fork = branch the conversation into a new one (git-branch glyph).
   (SVG copied verbatim from clients/vscode/webview/src/App.tsx IconFork.) */
const IconFork = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="4" cy="3.5" r="1.5" fill="currentColor" /><circle cx="4" cy="12.5" r="1.5" fill="currentColor" /><circle cx="12" cy="3.5" r="1.5" fill="currentColor" /><path d="M4 5v6M4 8h4.5A3.5 3.5 0 0 0 12 4.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** Copy for the two buttons — defaulted in English, overridable per host for i18n. */
export interface ConsolidateForkLabels {
  consolidate: string;
  consolidating: string;
  fork: string;
  forking: string;
}

export const DEFAULT_CONSOLIDATE_FORK_LABELS: ConsolidateForkLabels = {
  consolidate: 'Consolidate',
  consolidating: 'Consolidating…',
  fork: 'Fork',
  forking: 'Forking…',
};

export interface ConsolidateForkControlProps {
  /** Whether the chat is long enough / in a state where consolidation makes sense. */
  canConsolidate: boolean;
  /** A consolidation is in flight. */
  consolidating: boolean;
  /** A fork is in flight. */
  forking: boolean;
  onConsolidate(): void;
  onFork(): void;
  labels?: Partial<ConsolidateForkLabels>;
  className?: string;
}

// Theme tokens with layered fallbacks (web app tokens → VS Code editor tokens →
// a neutral literal), matching the rest of brain-ui. NEVER a bare hex — every
// value degrades through the host's own variables first so it reads in any theme.
const surface = 'var(--bf-surface, var(--bg-elevated, var(--vscode-editorWidget-background, transparent)))';
const border = 'var(--bf-border, var(--border-subtle, var(--vscode-panel-border, rgba(148,163,184,0.3))))';
const text = 'var(--bf-text, var(--text-primary, var(--vscode-foreground, inherit)))';

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  fontSize: 12,
  lineHeight: 1.2,
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: surface,
  color: text,
  cursor: 'pointer',
};

/**
 * Two buttons: Consolidate (compress the chat into a summary marker the rest of
 * the conversation builds on) and Fork (branch that summary into a new chat).
 * Both are disabled when consolidation isn't possible or either action is busy,
 * so a host can't fire a second op mid-flight.
 */
export function ConsolidateForkControl({
  canConsolidate,
  consolidating,
  forking,
  onConsolidate,
  onFork,
  labels,
  className,
}: ConsolidateForkControlProps) {
  const lab = { ...DEFAULT_CONSOLIDATE_FORK_LABELS, ...labels };
  const busy = consolidating || forking;
  const disabled = !canConsolidate || busy;
  const disabledStyle: CSSProperties = disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {};

  return (
    <div
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      role="group"
    >
      <button
        type="button"
        style={{ ...buttonStyle, ...disabledStyle }}
        aria-label={lab.consolidate}
        disabled={disabled}
        onClick={onConsolidate}
      >
        <IconConsolidate />
        <span>{consolidating ? lab.consolidating : lab.consolidate}</span>
      </button>
      <button
        type="button"
        style={{ ...buttonStyle, ...disabledStyle }}
        aria-label={lab.fork}
        disabled={disabled}
        onClick={onFork}
      >
        <IconFork />
        <span>{forking ? lab.forking : lab.fork}</span>
      </button>
    </div>
  );
}
