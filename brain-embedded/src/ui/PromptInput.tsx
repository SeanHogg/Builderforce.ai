import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';

/**
 * PromptInput — the embeddable ONE-LINE composer: a field and a send button.
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
  /** Rendered before the field, in the same row — a recipient picker, say. */
  leading?: ReactNode;
  /** Rendered under the row — a link through the host's router, or why it is disabled. */
  secondaryContent?: ReactNode;
  /** 1 = single line (default); more = a compact textarea. */
  rows?: number;
  className?: string;
  /** When false, Enter adds a newline and only the button sends. Default true. */
  submitOnEnter?: boolean;
}

const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', width: '100%' };

const fieldStyle: CSSProperties = {
  flex: '1 1 200px',
  minWidth: 0,
  minHeight: 42,
  boxSizing: 'border-box',
  background: 'var(--bg-base, #fff)',
  color: 'var(--text-primary, #111)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  lineHeight: 1.4,
  padding: '10px 12px',
  borderRadius: 'var(--radius-lg, 10px)',
  border: '1px solid var(--border-subtle, #c8c8c8)',
  resize: 'none',
};

const buttonStyle = (enabled: boolean): CSSProperties => ({
  flex: '0 0 auto',
  minWidth: 42,
  height: 42,
  padding: '0 16px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border-subtle, #c8c8c8)',
  borderRadius: 'var(--radius-lg, 10px)',
  background: enabled ? 'var(--accent, #2563eb)' : 'var(--bg-elevated, #eee)',
  color: enabled ? 'var(--text-on-accent, #fff)' : 'var(--text-muted, #666)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontSize: '1rem',
  fontWeight: 700,
});

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaLabel,
  disabled = false,
  busy = false,
  leading,
  secondaryContent,
  rows = 1,
  className,
  submitOnEnter = true,
}: PromptInputProps) {
  const canSubmit = value.trim().length > 0 && !disabled && !busy;

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
      <div style={rowStyle}>
        {leading}
        {rows <= 1 ? <input type="text" {...shared} /> : <textarea rows={rows} {...shared} />}
        <button type="submit" disabled={!canSubmit} aria-label={submitLabel} title={submitLabel} aria-busy={busy || undefined} style={buttonStyle(canSubmit)}>
          <span aria-hidden="true">{busy ? '…' : '↑'}</span>
        </button>
      </div>
      {secondaryContent && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #666)' }}>{secondaryContent}</div>}
    </form>
  );
}
