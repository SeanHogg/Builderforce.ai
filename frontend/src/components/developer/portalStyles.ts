/**
 * The Developer Portal's shared style tokens.
 *
 * Extracted when `PublishTab` moved to its own module and the two files started
 * carrying byte-identical copies of `card`, `chip`, `input` and the button trio.
 * Duplicated style objects are the quiet kind of drift: nothing breaks, the two
 * halves of one page simply stop looking like one page, and nobody can say when
 * it started.
 *
 * Every value resolves through a design token, so both themes are covered without
 * either being written twice. Nothing here is a fixed pixel width — `grid` uses
 * `minmax(min(100%, …))` so a 360px viewport wraps rather than overflows.
 */

export const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

export const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--font-size-body)',
  fontWeight: 700,
  color: 'var(--text-primary)',
};

export const muted: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
};

export const buttonPrimary: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  minHeight: 36,
};

export const buttonQuiet: React.CSSProperties = { ...buttonPrimary, background: 'none' };

export const buttonDanger: React.CSSProperties = {
  ...buttonQuiet,
  color: 'var(--coral-bright)',
  borderColor: 'var(--coral-bright)',
};

export const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
  background: 'var(--bg-elevated, var(--bg-base))',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  minHeight: 36,
};

/** Fluid grid — never a fixed px width that overflows a 360px viewport. */
export const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: 14,
};

export const chip = (tone: 'neutral' | 'good' | 'warn'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border-subtle)',
  color:
    tone === 'good' ? 'var(--success-text)'
    : tone === 'warn' ? 'var(--coral-bright)'
    : 'var(--text-secondary)',
  whiteSpace: 'nowrap',
});
