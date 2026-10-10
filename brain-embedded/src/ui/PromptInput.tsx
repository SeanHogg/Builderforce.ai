import { useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

/**
 * PromptInput — the embeddable ONE-LINE composer: one filled box holding the field
 * and a round trailing button (Send, or Stop while a turn streams).
 *
 * ── WHY IT LIVES IN THE PACKAGE ──────────────────────────────────────────────
 * PRD 14 §136 moves the Brain's UI out of the web app so an external embed and
 * builderforce.ai draw the same composer. This is the small one — the full chat
 * composer (attachments, model menu, modes) is `ChatInput`; this is the "ask the
 * agent something" row a host drops beside other controls.
 *
 * ── WHAT IT DOES NOT CARRY ───────────────────────────────────────────────────
 * No copy and no router. Every word it shows is handed in already translated,
 * because the package cannot know the host's locale; and a link under the field is
 * `secondaryContent` the host renders with its OWN router, because a plain anchor in
 * a client-routed app is a full page load. Colours are the host's design tokens with
 * legible fallbacks, so it reads in either theme without a stylesheet.
 */
export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Placeholder, translated by the host. */
  placeholder: string;
  /** The send button's accessible name — it draws an arrow. Translated by the host. */
  submitLabel: string;
  /** The field's accessible name when the placeholder alone is not enough. */
  ariaLabel?: string;
  disabled?: boolean;
  /** A turn is in flight: the button shows it is working. */
  busy?: boolean;
  /**
   * Interrupt the in-flight turn. While `busy` with an empty field, the trailing
   * button becomes Stop. Needs {@link stopLabel} too — the package carries no copy.
   */
  onStop?: () => void;
  /** The Stop button's accessible name, translated by the host. */
  stopLabel?: string;
  /** Rendered before the field, inside the box — a recipient picker, say. */
  leading?: ReactNode;
  /** Rendered under the box — a link through the host's router, or why it is disabled. */
  secondaryContent?: ReactNode;
  /** 1 = single line (default); more = a compact textarea. */
  rows?: number;
  className?: string;
  /** When false, Enter adds a newline and only the button sends. Default true. */
  submitOnEnter?: boolean;
}

/** ONE filled box — no outline of its own; an accent ring while it is in use. */
const boxStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: 8,
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 6px 6px 12px',
  borderRadius: 18,
  border: 'none',
  background: 'var(--chat-input-bg, var(--bg-elevated, #f3f4f6))',
  boxShadow: active ? '0 0 0 2px var(--accent, #2563eb)' : 'none',
  transition: 'box-shadow 120ms ease',
});

/** The field and its trailing button stay together when a wide `leading` wraps. */
const fieldRowStyle: CSSProperties = { display: 'flex', alignItems: 'flex-end', gap: 8, flex: '1 1 180px', minWidth: 0 };

const fieldStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 36,
  boxSizing: 'border-box',
  background: 'transparent',
  color: 'var(--text-primary, #111)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  lineHeight: 1.4,
  padding: '8px 0',
  border: 'none',
  outline: 'none',
  resize: 'none',
};

const roundButtonStyle = (enabled: boolean): CSSProperties => ({
  flex: '0 0 auto',
  width: 36,
  height: 36,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  background: enabled ? 'var(--accent, #2563eb)' : 'var(--surface-interactive, rgba(128, 128, 128, 0.18))',
  color: enabled ? 'var(--text-on-accent, #fff)' : 'var(--text-muted, #6b7280)',
  cursor: enabled ? 'pointer' : 'not-allowed',
});

const ArrowUpGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const StopGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaLabel,
  disabled = false,
  busy = false,
  onStop,
  stopLabel,
  leading,
  secondaryContent,
  rows = 1,
  className,
  submitOnEnter = true,
}: PromptInputProps) {
  const [focused, setFocused] = useState(false);
  const empty = value.trim().length === 0;
  const canSubmit = !empty && !disabled && !busy;
  // Streaming with nothing typed: the trailing button interrupts the turn instead.
  const showStop = busy && empty && !!onStop && !!stopLabel;

  const submit = () => { if (canSubmit) onSubmit(); };
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); submit(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!submitOnEnter || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const shared = {
    value,
    placeholder,
    disabled,
    'aria-label': ariaLabel ?? placeholder,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    onKeyDown: handleKeyDown,
    style: fieldStyle,
  };

  return (
    <form onSubmit={handleSubmit} className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={boxStyle(focused || !empty)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        {leading}
        <div style={fieldRowStyle}>
          {rows <= 1 ? <input type="text" {...shared} /> : <textarea rows={rows} {...shared} />}
          {showStop ? (
            <button type="button" onClick={onStop} aria-label={stopLabel} title={stopLabel} style={roundButtonStyle(true)}>
              <StopGlyph />
            </button>
          ) : (
            <button type="submit" disabled={!canSubmit} aria-label={submitLabel} title={submitLabel} aria-busy={busy || undefined} style={roundButtonStyle(canSubmit)}>
              <ArrowUpGlyph />
            </button>
          )}
        </div>
      </div>
      {secondaryContent && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #666)' }}>{secondaryContent}</div>}
    </form>
  );
}
