'use client';

/**
 * ViewToggle — the canonical "Card | List" segmented control.
 *
 * Single source of truth for the card/table view switcher that was previously
 * duplicated inline across Projects, Dashboard, Content Manager and PRDs. Any
 * page that renders the same data as both a card grid and a table should use
 * this control rather than re-implementing the button group.
 *
 * State is owned by the caller (session-only `useState`); this component is
 * purely presentational so each page keeps control over its own default.
 */
export type ViewMode = 'card' | 'table';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Label for the card option. Defaults to "Card". */
  cardLabel?: string;
  /** Label for the table option. Defaults to "List". */
  tableLabel?: string;
  /** Optional className passthrough for layout tweaks. */
  className?: string;
}

const buttonStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: '0.8rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: active ? 'var(--coral-bright)' : 'transparent',
  color: active ? '#fff' : 'var(--text-secondary)',
});

export function ViewToggle({
  value,
  onChange,
  cardLabel = 'Card',
  tableLabel = 'List',
  className,
}: ViewToggleProps) {
  return (
    <div
      className={className}
      role="group"
      aria-label="View mode"
      style={{
        display: 'flex',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: 2,
      }}
    >
      <button
        type="button"
        onClick={() => onChange('card')}
        aria-pressed={value === 'card'}
        style={buttonStyle(value === 'card')}
      >
        {cardLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={value === 'table'}
        style={buttonStyle(value === 'table')}
      >
        {tableLabel}
      </button>
    </div>
  );
}
