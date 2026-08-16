/**
 * No `'use client'` here — every importer already declares the boundary. See
 * the note in `components/Pagination.tsx`.
 *
 * FilterChips — the canonical chip row for filtering a collection.
 *
 * The marketplace proved the pattern (families over kinds over a grid) and every
 * other catalogue surface then went without: /prompts offered a sort dropdown
 * and no categories at all, and /blog offered nothing but a page number for 125
 * articles. This is that control, extracted — a single row of pressable chips
 * with an optional count on each, so "Careers 29" tells a reader what a chip is
 * worth pressing before they press it.
 *
 * A chip with a zero count is DROPPED, not disabled: a filter that selects
 * nothing is noise, and the counts are always derived from the loaded corpus, so
 * the row shrinks and grows with the data rather than with a hand-kept list.
 */

export interface FilterChip {
  id: string;
  label: string;
  /** Rendered beside the label. Omit for chips that don't count anything. */
  count?: number;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  /** The pressed chip's id. `null`/'' means none. */
  value: string | null;
  onChange: (id: string) => void;
  /** Accessible name for the row (it is a `role="group"`). */
  ariaLabel: string;
  /** Quieter chips for a secondary row (e.g. tags under a topic). */
  size?: 'md' | 'sm';
  className?: string;
}

const base = (active: boolean, small: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: small ? '4px 10px' : '7px 14px',
  borderRadius: 'var(--radius-full)',
  border: `1px solid ${active ? 'transparent' : 'var(--border-subtle)'}`,
  background: active ? 'var(--coral-bright)' : 'var(--bg-elevated)',
  color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
  fontSize: small ? 'var(--font-size-eyebrow)' : 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

export function FilterChips({ chips, value, onChange, ariaLabel, size = 'md', className }: FilterChipsProps) {
  const visible = chips.filter((c) => c.count === undefined || c.count > 0);
  if (visible.length <= 1) return null;
  const small = size === 'sm';

  return (
    <div
      className={className}
      role="group"
      aria-label={ariaLabel}
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
    >
      {visible.map((chip) => {
        const active = chip.id === (value ?? '');
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            aria-pressed={active}
            style={base(active, small)}
          >
            {chip.label}
            {chip.count !== undefined && (
              <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{chip.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FilterChips;
