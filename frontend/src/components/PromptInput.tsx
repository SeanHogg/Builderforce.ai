'use client';

import Link from 'next/link';

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Button label when enabled (e.g. "Send" or "Send to Claw"). */
  submitLabel?: string;
  /** Optional link below the input (e.g. "Manage workforce / claws"). */
  secondaryLink?: { label: string; href: string };
  /** Number of visible rows for the input (1 = single line, 2 = compact multiline). Default 1. */
  rows?: number;
  /** Optional class name for the container. */
  className?: string;
  /** If false, Enter does not submit (e.g. for chat where only the button sends). Default true. */
  submitOnEnter?: boolean;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: '100%',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  fontSize: '0.875rem',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
  border: '1px solid var(--border-subtle)',
  fontFamily: 'var(--font-body)',
  lineHeight: 1.4,
  resize: 'none',
};

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  flexShrink: 0,
  height: 42,
  minWidth: 42,
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: disabled ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: disabled ? 'var(--text-muted)' : '#fff',
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '0.875rem',
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
});

/**
 * Streamlined, reusable prompt/chat input: single row (or compact multiline) + send button.
 * Use on the dashboard ("What should we build?") and in the IDE AI chat.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask or describe a task…',
  disabled = false,
  submitLabel = 'Send',
  secondaryLink,
  rows = 1,
  className,
  submitOnEnter = true,
}: PromptInputProps) {
  const canSubmit = value.trim().length > 0 && !disabled;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (submitOnEnter && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className} style={containerStyle}>
      <div style={rowStyle}>
        {rows <= 1 ? (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            style={{ ...inputStyle, height: 42 }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          />
        ) : (
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          />
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          title={submitLabel}
          style={buttonStyle(!canSubmit)}
        >
          {disabled ? '⏳' : '↑'}
        </button>
      </div>
      {secondaryLink && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Link
            href={secondaryLink.href}
            style={{ fontSize: 12, color: 'var(--coral-bright)', textDecoration: 'none' }}
          >
            {secondaryLink.label}
          </Link>
        </div>
      )}
    </form>
  );
}
