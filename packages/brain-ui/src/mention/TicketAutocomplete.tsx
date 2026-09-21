/**
 * #ticket autocomplete — the shared composer typeahead that lets a user tag
 * a ticket in the chat by typing "#". Similar to @mention but for tickets.
 *
 * Headless-ish: {@link useTicketAutocomplete} owns the token/selection state and
 * returns handlers you spread onto YOUR <textarea> plus a `popup` node you render
 * inside a `position: relative` composer container. Picking a ticket replaces the
 * "#query" fragment with the ticket reference (e.g., "#123") and calls `onPick`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activeHashtagToken,
  filterTicketCandidates,
  type TicketTag,
  type MentionToken,
} from '@seanhogg/builderforce-brain-embedded';

export interface TicketAutocompleteLabels {
  /** Heading above the list, e.g. "Tag ticket". */
  title?: string;
  /** Row sub-label for ticket status, e.g. "In Progress". */
  status?: string;
  /** Text when no tickets match. */
  noMatches?: string;
}

export interface UseTicketAutocompleteOptions {
  /** Ref to the composer's <textarea> — read for the live caret position. */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Current composer text (controlled). */
  value: string;
  /** Setter for the composer text (same one the textarea's onChange calls). */
  setValue: (v: string) => void;
  /** The available tickets to choose from. */
  tickets: TicketTag[];
  /** Called with the ticket the user picked. */
  onPick: (t: TicketTag) => void;
  labels?: TicketAutocompleteLabels;
  /** Suppress the picker entirely (e.g. while a run is streaming). */
  disabled?: boolean;
}

export interface TicketAutocomplete {
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

export function useTicketAutocomplete(opts: UseTicketAutocompleteOptions): TicketAutocomplete {
  const { textareaRef, value, setValue, tickets, onPick, labels, disabled } = opts;
  const [token, setToken] = useState<MentionToken | null>(null);
  const [index, setIndex] = useState(0);

  const matches = useMemo(
    () => (token && !disabled ? filterTicketCandidates(tickets, token.query) : []),
    [token, tickets, disabled],
  );
  const open = !disabled && token != null && matches.length > 0;

  // Re-detect the active token from the live caret.
  const recompute = useCallback(() => {
    const el = textareaRef.current;
    if (!el || disabled || tickets.length === 0) { setToken(null); return; }
    const next = activeHashtagToken(el.value, el.selectionStart ?? el.value.length);
    setToken(next);
    setIndex(0);
  }, [textareaRef, disabled, tickets.length]);

  // The value change commits the caret too, so recompute after every edit.
  useEffect(() => { recompute(); }, [value, recompute]);

  const choose = useCallback((t: TicketTag) => {
    const el = textareaRef.current;
    const tk = token ?? (el ? activeHashtagToken(el.value, el.selectionStart ?? 0) : null);
    if (tk) {
      // Replace "#query" with "#key" (e.g., "#ABC-123") or "#id" (e.g., "#123")
      const ref = t.key ?? String(t.id);
      let after = value.slice(tk.end);
      if (after.startsWith(' ')) after = after.slice(1);
      setValue(value.slice(0, tk.start) + `#${ref}` + after);
      const caret = tk.start + ref.length + 1; // Position after "#ref"
      // Restore the caret where the token was, after React commits the new value.
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) { node.focus(); try { node.setSelectionRange(caret, caret); } catch { /* noop */ } }
      });
    }
    setToken(null);
    onPick(t);
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
    ? <TicketPopup matches={matches} index={index} labels={labels} onHover={setIndex} onPick={choose} />
    : null;

  return { onKeyDown, onSelect: recompute, popup, open };
}

// ── Presentational popup ──────────────────────────────────────────────────────

function TicketPopup({ matches, index, labels, onHover, onPick }: {
  matches: TicketTag[];
  index: number;
  labels?: TicketAutocompleteLabels;
  onHover: (i: number) => void;
  onPick: (t: TicketTag) => void;
}) {
  if (matches.length === 0) {
    return (
      <div style={POP.anchor}>
        <div style={POP.empty}>
          {labels?.noMatches ?? 'No tickets found'}
        </div>
      </div>
    );
  }

  return (
    <div style={POP.anchor}>
      <ul role="listbox" aria-label={labels?.title ?? 'Tag ticket'} style={POP.list}>
        {labels?.title && <li aria-hidden style={POP.group}>{labels.title}</li>}
        {matches.map((t, i) => {
          const ref = t.key ?? String(t.id);
          return (
          <li
            key={ref}
            role="option"
            aria-selected={i === index}
            onMouseDown={(e) => { e.preventDefault(); onPick(t); }}
            onMouseEnter={() => onHover(i)}
            style={POP.item(i === index)}
          >
            <span style={POP.ref}>#{ref}</span>
            <span style={POP.title}>{t.title}</span>
            {t.status && <span style={POP.status}>{labels?.status ?? t.status}</span>}
          </li>
        )})}
      </ul>
    </div>
  );
}

// Theme tokens — same as MentionAutocomplete:
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
  empty: React.CSSProperties;
  group: React.CSSProperties;
  ref: React.CSSProperties;
  title: React.CSSProperties;
  status: React.CSSProperties;
  item: (active: boolean) => React.CSSProperties;
} = {
  anchor: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 60, width: 'min(320px, 92vw)' },
  list: {
    margin: 0, padding: 4, listStyle: 'none',
    maxHeight: 264, overflowY: 'auto',
    borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface,
    boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
  },
  empty: {
    margin: 0, padding: '12px 16px', listStyle: 'none',
    borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface,
    color: T.muted, fontSize: 13,
  },
  group: { padding: '4px 8px 5px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.muted },
  ref: { fontSize: 13, fontWeight: 600, color: T.text, fontFamily: 'monospace' },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text, fontSize: 13 },
  status: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.muted, flexShrink: 0 },
  item: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
    background: active ? T.active : 'transparent',
  }),
};
