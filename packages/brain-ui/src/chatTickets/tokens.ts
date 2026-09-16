/**
 * The chat-ticket rail's theme tokens — ONE definition, shared by every piece of
 * the rail (the panel and the per-chip parts it composes), so a second file can
 * never introduce a second palette that drifts in one host's dark theme.
 *
 * Each value is a CSS-var fallback CHAIN read left→right: first the web app's
 * semantic tokens (--bf-ct-* / --bg-base / --text-primary …), then the VS Code
 * webview's tokens (--vscode-* / --bf-*), then a literal. The webview does NOT
 * define the --bf-ct-* / --bg-base names, so before this chain the native <select>s
 * fell through to `transparent`/`inherit` with no color-scheme and Chromium drew
 * them as default LIGHT controls (white popup) in a dark editor. Resolving to the
 * editor's --vscode-dropdown-* tokens fixes them in BOTH hosts, light AND dark.
 */
export const V = {
  border: 'var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))',
  surface: 'var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))',
  surface2: 'var(--bf-ct-surface-2, var(--bg-base, var(--bf-surface-2, var(--vscode-textBlockQuote-background, transparent))))',
  // Form controls specifically prefer the editor's dropdown/input tokens so the
  // native <select> and its option list match VS Code's own dropdowns.
  field: 'var(--bf-ct-surface-2, var(--bg-base, var(--vscode-dropdown-background, var(--bf-surface, transparent))))',
  fieldText: 'var(--bf-ct-text, var(--text-primary, var(--vscode-dropdown-foreground, var(--bf-text, inherit))))',
  text: 'var(--bf-ct-text, var(--text-primary, var(--bf-text, inherit)))',
  text2: 'var(--bf-ct-text-2, var(--text-secondary, var(--bf-text, inherit)))',
  muted: 'var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, #6b7280)))',
  accent: 'var(--bf-ct-accent, var(--accent, var(--bf-accent, #3b82f6)))',
};
