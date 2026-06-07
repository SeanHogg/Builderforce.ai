'use client';

/**
 * ViewToggle — the canonical segmented view-mode control.
 *
 * Single source of truth for the view switcher across every page that renders a
 * collection in more than one layout (Projects, Dashboard, Content Manager,
 * Tasks, Workforce, …). Any page showing a collection of cards should use this
 * control rather than re-implementing the button group.
 *
 * Two ways to drive it:
 *
 *  1. Enable-flags (preferred) — turn modes on declaratively. The component owns
 *     the canonical label + ordering for each mode, so every page reads the same:
 *
 *       <ViewToggle value={v} onChange={setV} />                  // Card | List
 *       <ViewToggle value={v} onChange={setV} card table calendar gantt />
 *       <ViewToggle value={v} onChange={setV} board table calendar gantt />
 *
 *     With no flags it falls back to the common Card | List pair. As soon as any
 *     flag is set, only the enabled modes show, in canonical order
 *     (board → card → table → calendar → gantt).
 *
 *  2. `options` escape hatch — pass an explicit option list for bespoke mode sets
 *     or custom labels the flags don't cover.
 *
 * State is owned by the caller (session-only `useState`); this component is
 * purely presentational so each page keeps control over its own default.
 */
export type ViewMode = 'card' | 'table';

/** Every mode the canonical toggle knows how to render, in display order. */
export type CanonicalViewMode = 'board' | 'card' | 'table' | 'calendar' | 'gantt';

export interface ViewOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading icon. Canonical modes get one automatically. */
  icon?: React.ReactNode;
}

/** Canonical order + default labels — the single source of truth for the toggle. */
const CANONICAL_ORDER: CanonicalViewMode[] = ['board', 'card', 'table', 'calendar', 'gantt'];
const CANONICAL_LABELS: Record<CanonicalViewMode, string> = {
  board: 'Board',
  card: 'Card',
  table: 'List',
  calendar: 'Calendar',
  gantt: 'Gantt',
};

/** Shared chrome for every mode glyph — stroke-based 24×24, sized down inline. */
const iconBase: React.CSSProperties = {
  width: 15,
  height: 15,
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  flexShrink: 0,
};

/** Canonical per-mode glyphs (aria-hidden — the label carries the meaning). */
const CANONICAL_ICONS: Record<CanonicalViewMode, React.ReactNode> = {
  board: (
    <svg viewBox="0 0 24 24" style={iconBase} aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="9.5" y="4" width="5" height="11" rx="1" />
      <rect x="16" y="4" width="5" height="14" rx="1" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" style={iconBase} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  table: (
    <svg viewBox="0 0 24 24" style={iconBase} aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" style={iconBase} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  gantt: (
    <svg viewBox="0 0 24 24" style={iconBase} aria-hidden="true">
      <line x1="4" y1="6" x2="14" y2="6" />
      <line x1="8" y1="12" x2="19" y2="12" />
      <line x1="5" y1="18" x2="12" y2="18" />
    </svg>
  ),
};

interface ViewToggleProps<T extends string> {
  value: T;
  onChange: (mode: T) => void;
  /**
   * Explicit option list. Takes precedence over every enable-flag; use it for
   * bespoke mode sets or custom labels the flags don't cover.
   */
  options?: ViewOption<T>[];
  // --- Enable-flags (ignored when `options` is set) ------------------------
  /** Enable the kanban "Board" mode. */
  board?: boolean;
  /** Enable the "Card" mode. */
  card?: boolean;
  /** Enable the "List/Table" mode. */
  table?: boolean;
  /** Enable the "Calendar" mode. */
  calendar?: boolean;
  /** Enable the "Gantt" mode. */
  gantt?: boolean;
  // --- Label overrides for the default Card | List pair --------------------
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

export function ViewToggle<T extends string = ViewMode>({
  value,
  onChange,
  options,
  board,
  card,
  table,
  calendar,
  gantt,
  cardLabel,
  tableLabel,
  className,
}: ViewToggleProps<T>) {
  const enabled: Record<CanonicalViewMode, boolean> = { board: !!board, card: !!card, table: !!table, calendar: !!calendar, gantt: !!gantt };
  // No flags set → the common Card | List pair (with optional label overrides).
  const anyFlag = CANONICAL_ORDER.some((m) => enabled[m]);
  if (!anyFlag) {
    enabled.card = true;
    enabled.table = true;
  }

  const labelFor = (mode: CanonicalViewMode): string => {
    if (mode === 'card' && cardLabel) return cardLabel;
    if (mode === 'table' && tableLabel) return tableLabel;
    return CANONICAL_LABELS[mode];
  };

  const opts: ViewOption<T>[] =
    options ?? CANONICAL_ORDER.filter((m) => enabled[m]).map((m) => ({ value: m as T, label: labelFor(m) }));

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
