/**
 * Shared visual atoms for the Evermind console and its sections.
 *
 * The console renders identically in two hosts (the web IDE and the VS Code sidebar
 * webview) that share no CSS, so every colour resolves through a CASCADE of custom
 * properties: evermind-namespaced → host app tokens → VS Code tokens → a legible
 * literal. That is what lets the same component read natively in light and dark, on
 * both surfaces, with no per-host stylesheet.
 *
 * These live here rather than inside the console because the test bench, maintenance
 * and analyzer sections are separate components that must look like the same panel —
 * one definition, not four near-copies.
 */
import type React from 'react';
import { nativeOptionStyle } from '../optionStyle';

/** Cascading theme tokens — see the file header for the cascade order. */
export const C = {
  surface: 'var(--bf-ev-surface, var(--bg-surface, var(--bf-surface, var(--vscode-editorWidget-background, transparent))))',
  surface2: 'var(--bf-ev-surface-2, var(--bg-elevated, var(--bf-surface-2, var(--vscode-textBlockQuote-background, rgba(148,163,184,0.08)))))',
  border: 'var(--bf-ev-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))',
  text: 'var(--bf-ev-text, var(--text-primary, var(--bf-text, inherit)))',
  text2: 'var(--bf-ev-text-2, var(--text-secondary, var(--bf-text-muted, #6b7280)))',
  accent: 'var(--bf-ev-accent, var(--coral-bright, var(--accent, var(--bf-accent, #ff6b5e))))',
  danger: 'var(--bf-ev-danger, var(--danger-text, #d9534f))',
  ok: 'var(--bf-ev-ok, var(--success-text, #16a34a))',
  warnText: 'var(--bf-warn-text, #92400e)',
  warnBg: 'var(--bf-warn-bg, #fef3c7)',
  warnBorder: 'var(--bf-warn-border, #f59e0b)',
};

export const italic: React.CSSProperties = { margin: 0, fontSize: '0.78rem', color: C.text2, fontStyle: 'italic' };
export const fieldLabel: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: C.text2 };
export const fieldTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 600, color: C.text };
export const fieldHint: React.CSSProperties = { fontSize: '0.72rem', color: C.text2, lineHeight: 1.4 };
export const select: React.CSSProperties = {
  padding: '7px 9px', fontSize: '0.8rem', borderRadius: 8,
  border: `1px solid ${C.border}`, background: C.surface2, color: C.text, boxSizing: 'border-box',
};
/** Every native <option> carries its own opaque bg/fg — see nativeOptionStyle. */
export const optionStyle = nativeOptionStyle;

/** A section divider block: a titled group inside the console card. */
export const sectionBlock: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  borderTop: `1px solid ${C.border}`, paddingTop: 10,
};

/** Monospace output surface for generated model text. */
export const outputBox: React.CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: '0.74rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px',
  color: C.text, maxHeight: 220, overflow: 'auto',
};

export function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8,
    border: '1px solid transparent',
    background: disabled ? C.surface2 : C.accent,
    color: disabled ? C.text2 : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
  };
}

export function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8,
    border: `1px solid ${C.border}`, background: 'transparent',
    color: disabled ? C.text2 : C.text,
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.7 : 1,
  };
}

/** A destructive action (re-seed, purge): reads as dangerous without shouting. */
export function dangerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, borderRadius: 8,
    border: `1px solid ${disabled ? C.border : C.danger}`, background: 'transparent',
    color: disabled ? C.text2 : C.danger,
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.7 : 1,
  };
}

export const ghostBtn: React.CSSProperties = {
  marginLeft: 'auto', padding: '2px 8px', fontSize: '0.9rem', lineHeight: 1,
  borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent',
  color: C.text2, cursor: 'pointer',
};

export const linkBtn: React.CSSProperties = {
  padding: 0, fontSize: '0.7rem', fontWeight: 600, border: 'none', background: 'transparent',
  color: C.accent, cursor: 'pointer',
};

export function pill(seeded: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
    border: `1px solid ${C.border}`, background: C.surface2,
    color: seeded ? C.accent : C.text2,
  };
}

export function tag(muted: boolean): React.CSSProperties {
  return {
    fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.border}`,
    color: muted ? C.text2 : C.accent, background: C.surface,
  };
}

/** A pass/fail chip for a graded generation or a knowledge verdict. */
export function verdictTag(tone: 'ok' | 'warn' | 'bad'): React.CSSProperties {
  const color = tone === 'ok' ? C.ok : tone === 'warn' ? C.warnText : C.danger;
  return {
    fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    padding: '1px 6px', borderRadius: 5, whiteSpace: 'nowrap',
    color, border: `1px solid ${color}`,
    ...(tone === 'warn' ? { background: C.warnBg } : {}),
  };
}

/** The "not distilled" / quarantine warning styling, shared by every warning surface. */
export const warnBox: React.CSSProperties = {
  margin: 0, fontSize: '0.74rem', lineHeight: 1.5, borderRadius: 6, padding: '6px 8px',
  color: C.warnText, background: C.warnBg, border: `1px solid ${C.warnBorder}`,
};
