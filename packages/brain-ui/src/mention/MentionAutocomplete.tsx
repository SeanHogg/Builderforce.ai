/**
 * @-mention autocomplete — the shared composer typeahead that lets a user direct
 * the next chat turn at an invited participant (an agent OR a person) by typing
 * "@". The single source of truth for the interaction, rendered identically on the
 * web app's <ChatInput> and inside the VS Code webview's composer.
 *
 * Headless-ish: {@link useMentionAutocomplete} owns the token/selection state and
 * returns handlers you spread onto YOUR <textarea> plus a `popup` node you render
 * inside a `position: relative` composer container. Picking a participant strips
 * the "@query" fragment (the picked recipient is shown by the composer's "To:"
 * chip, so it need not linger in the body) and calls `onPick` — wire that to the
 * host's `setRecipientChoice`, reusing the whole directed-message routing spine.
 *
 * Theme-aware via the same CSS-var fallback chain the ChatTicketsPanel uses, so the
 * popup reads in BOTH the web app (light/dark) and the editor's active theme.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activeMentionToken,
  filterMentionCandidates,
  type DirectedRecipient,
  type MentionToken,
} from '@seanhogg/builderforce-brain-embedded';
import { Avatar } from '../ParticipantBadge';

export interface MentionLabels {
  /** Heading above the list, e.g. "Direct to". */
  title?: string;
  /** Row sub-label for an invited agent, e.g. "Agent". */
  agent?: string;
  /** Row sub-label for an invited person, e.g. "Person". */
  human?: string;
}

export interface UseMentionAutocompleteOptions {
  /** Ref to the composer's <textarea> — read for the live caret position. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Current composer text (controlled). */
  value: string;
  /** Setter for the composer text (same one the textarea's onChange calls). */
  setValue: (v: string) => void;
  /** The chat's invited participants (agents + humans) offered by the picker. */
  participants: DirectedRecipient[];
  /** Called with the participant the user picked — wire to `setRecipientChoice`. */
  onPick: (r: DirectedRecipient) => void;
  labels?: MentionLabels;
  /** Suppress the picker entirely (e.g. while a run is streaming). */
  disabled?: boolean;
}

export interface MentionAutocomplete {
  /**
   * Attach to the textarea's onKeyDown BEFORE your own logic. Returns true when it
   * consumed the key (nav / select / escape) — when true you must NOT also submit
   * or insert a newline for that key.
   */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Attach to the textarea's onSelect so a caret move re-detects the token. */
  onSelect: () => void;
  /** The popup element; render it inside a `position: relative` container. */
  popup: React.ReactNode;
  /** True while the picker is open (its nav keys are being intercepted). */
  open: boolean;
}

export function useMentionAutocomplete(opts: UseMentionAutocompleteOptions): MentionAutocomplete {
  const { textareaRef, value, setValue, participants, onPick, labels, disabled } = opts;
  const [token, setToken] = useState<MentionToken | null>(null);
  const [index, setIndex] = useState(0);

  const matches = useMemo(
    () => (token && !disabled ? filterMentionCandidates(participants, token.query) : []),
    [token, participants, disabled],
  );
  const open = !disabled && token != null && matches.length > 0;

  // Re-detect the active token from the live caret. Cheap; safe to call often.
  const recompute = useCallback(() => {
    const el = textareaRef.current;
    if (!el || disabled || participants.length === 0) { setToken(null); return; }
    const next = activeMentionToken(el.value, el.selectionStart ?? el.value.length);
    setToken(next);
    setIndex(0);
  }, [textareaRef, disabled, participants.length]);

  // The value change commits the caret too, so recompute after every edit.
  useEffect(() => { recompute(); }, [value, recompute]);

  const choose = useCallback((r: DirectedRecipient) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? activeMentionToken(el.value, el.selectionStart ?? 0) : null);
    if (tk) {
      // Strip the "@query" token (and a single trailing space) — the picked
      // recipient shows in the composer's "To:" chip, so it need not stay inline.
      let after = value.slice(tk.end);
      if (after.startsWith(' ')) after = after.slice(1);
      setValue(value.slice(0, tk.start) + after);
      const caret = tk.start;
      // Restore the caret where the token was, after React commits the new value.
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) { node.focus(); try { node.setSelectionRange(caret, caret); } catch { /* noop */ } }
      });
    }
    setToken(null);
    onPick(r);
  }, [token, value, setValue, onPick, textareaRef]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setIndex((i) => (i + 1) % matches.length); return true;
      case 'ArrowUp': e.preventDefault(); setIndex((i) => (i - 1 + matches.length) % matches.length); return true;
      case 'Enter':
      case 'Tab': e.preventDefault(); choose(matches[Math.min(index, matches.length - 1)]); return true;
      case 'Escape': e.preventDefault(); setToken(null); return true;
      default: return false;
    }
  }, [open, matches, index, choose]);

  const popup = open
    ? <MentionPopup matches={matches} index={index} labels={labels} onHover={setIndex} onPick={choose} />
    : null;

  return { onKeyDown, onSelect: recompute, popup, open };
}

// ── Presentational popup ──────────────────────────────────────────────────────

function MentionPopup({ matches, index, labels, onHover, onPick }: {
  matches: DirectedRecipient[];
  index: number;
  labels?: MentionLabels;
  onHover: (i: number) => void;
  onPick: (r: DirectedRecipient) => void;
}) {
  return (
    <div style={POP.anchor}>
      <ul role="listbox" aria-label={labels?.title ?? 'Direct to'} style={POP.list}>
        {labels?.title && <li aria-hidden style={POP.group}>{labels.title}</li>}
        {matches.map((m, i) => (
          <li
            key={`${m.kind}:${m.ref}`}
            role="option"
            aria-selected={i === index}
            // onMouseDown (not onClick) + preventDefault so the click doesn't blur
            // the textarea before we can restore its caret.
            onMouseDown={(e) => { e.preventDefault(); onPick(m); }}
            onMouseEnter={() => onHover(i)}
            style={POP.item(i === index)}
          >
            <Avatar name={m.name} kind={m.kind} size={20} />
            <span style={POP.name}>{m.name}</span>
            <span style={POP.kind}>{m.kind === 'agent' ? (labels?.agent ?? 'Agent') : (labels?.human ?? 'Person')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Theme tokens — the same left→right CSS-var fallback chain ChatTicketsPanel uses:
// web app semantic tokens first, then the VS Code webview's --vscode-* tokens,
// then a literal — so the popup themes in BOTH hosts, light AND dark.
const T = {
  border: 'var(--bf-ct-border, var(--border-subtle, var(--bf-border, var(--vscode-panel-border, rgba(148,163,184,0.3)))))',
  surface: 'var(--bf-ct-surface, var(--bg-elevated, var(--bf-surface, var(--vscode-editorWidget-background, #1e1e1e))))',
  hover: 'var(--surface-interactive, var(--bg-base, var(--vscode-list-hoverBackground, rgba(148,163,184,0.16))))',
  active: 'var(--surface-coral-soft, var(--vscode-list-activeSelectionBackground, rgba(59,130,246,0.18)))',
  text: 'var(--bf-ct-text, var(--text-primary, var(--bf-text, var(--vscode-foreground, inherit))))',
  muted: 'var(--bf-ct-text-muted, var(--text-muted, var(--bf-text-muted, var(--vscode-descriptionForeground, #6b7280))))',
};

const POP: {
  anchor: React.CSSProperties;
  list: React.CSSProperties;
  group: React.CSSProperties;
  name: React.CSSProperties;
  kind: React.CSSProperties;
  item: (active: boolean) => React.CSSProperties;
} = {
  // Floats above the composer container (which must be position: relative).
  anchor: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 60, width: 'min(320px, 92vw)' },
  list: {
    margin: 0, padding: 4, listStyle: 'none',
    maxHeight: 264, overflowY: 'auto',
    borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface,
    boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
  },
  group: { padding: '4px 8px 5px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.muted },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text, fontSize: 13, fontWeight: 600 },
  kind: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.muted, flexShrink: 0 },
  item: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
    background: active ? T.active : 'transparent',
  }),
};
