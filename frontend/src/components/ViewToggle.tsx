'use client';

/**
 * ViewToggle — the canonical segmented view-mode control.
 *
 * Single source of truth for the view switcher that was previously duplicated
 * inline across Projects, Dashboard, Content Manager and PRDs. Any page that
 * renders the same data in multiple layouts should use this control rather than
 * re-implementing the button group.
 *
 * Defaults to a two-option "Card | List" switch. Pass `options` for any other
 * set of modes (e.g. Card | List | Calendar | Gantt) — the component stays
 * generic over the mode union, so callers keep full type-safety on `value`.
 *
 * State is owned by the caller (session-only `useState`); this component is
 * purely presentational so each page keeps control over its own default.
 */
export type ViewMode = 'card' | 'table';

export interface ViewOption<T extends string> {
  value: T;
  label: string;
}

interface ViewToggleProps<T extends string> {
  value: T;
  onChange: (mode: T) => void;
  /** Full set of options. When omitted, falls back to Card | List using the *Label props. */
  options?: ViewOption<T>[];
  /** Label for the default card option. Defaults to "Card". Ignored when `options` is set. */
  cardLabel?: string;
  /** Label for the default table option. Defaults to "List". Ignored when `options` is set. */
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

export function ViewToggle<T extends string = ViewMode>({
  value,
  onChange,
  options,
  cardLabel = 'Card',
  tableLabel = 'List',
  className,
}: ViewToggleProps<T>) {
  const opts: ViewOption<T>[] =
    options ?? [
      { value: 'card' as T, label: cardLabel },
      { value: 'table' as T, label: tableLabel },
    ];
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
      {opts.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          style={buttonStyle(value === opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
