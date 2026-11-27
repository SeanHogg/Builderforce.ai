/**
 * The Skills page's stylesheet. Colours, fonts and borders come ONLY from the editor's
 * theme variables (`var(--vscode-*)`), so it follows every theme (light, dark, high
 * contrast) without a palette of its own. The layout is one column that wraps, so it
 * holds at the narrowest sidebar width.
 */
export const SKILLS_CSS = `
* { box-sizing: border-box; }
body { margin: 0; padding: 8px 12px 16px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); font: var(--vscode-font-size) var(--vscode-font-family); }
h2 { margin: 16px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); }
h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
p { margin: 4px 0; line-height: 1.4; overflow-wrap: anywhere; }
.muted { color: var(--vscode-descriptionForeground); }
.card { margin: 6px 0; padding: 8px; border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent)); border-radius: 4px; background: var(--vscode-editorWidget-background, transparent); }
.card.live { border-color: var(--vscode-focusBorder); }
.card.attention { border-color: var(--vscode-editorWarning-foreground); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0; }
.row > .grow { flex: 1 1 120px; min-width: 0; }
.stack { display: flex; flex-direction: column; gap: 6px; }
button { padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.danger { color: var(--vscode-errorForeground); background: transparent; border-color: var(--vscode-errorForeground); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
input[type=text], input[type=password], input[type=number], input[type=time] { width: 100%; padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; font: inherit; }
input[type=number] { width: 5em; }
input[type=time] { width: auto; }
label { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
label.block { display: block; }
.badge { display: inline-block; padding: 0 6px; border-radius: 8px; font-size: 11px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
.badge.failed, .badge.denied { color: var(--vscode-errorForeground); background: transparent; border: 1px solid var(--vscode-errorForeground); }
.badge.succeeded { color: var(--vscode-testing-iconPassed, var(--vscode-badge-foreground)); background: transparent; border: 1px solid currentColor; }
.error { margin: 8px 0; padding: 6px 8px; color: var(--vscode-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); background: var(--vscode-inputValidation-errorBackground, transparent); border-radius: 2px; overflow-wrap: anywhere; }
.step { padding: 4px 0; border-top: 1px solid var(--vscode-panel-border, transparent); }
.step:first-of-type { border-top: 0; }
details { margin: 4px 0; }
summary { cursor: pointer; overflow-wrap: anywhere; }
progress { width: 100%; height: 6px; }
code, .mono { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); overflow-wrap: anywhere; }
`;
