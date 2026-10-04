import { Icon } from '@/components/ui/Icon';

/**
 * The Brain empty state's starting points — ONE tile and ONE group shape for every
 * kind of starter (onboarding, Work-mode jobs, "what are we making?" capabilities), so
 * the lists a user scans before the first message read as one list, not three
 * differently-sized grids stacked under each other.
 *
 * A tile is a row (icon · label · one-line hint), not a card: in a ~340px docked column
 * the old 56–84px cards showed two options above the fold; rows show the whole set.
 * The grid is `auto-fill` / `minmax(min(100%, 220px), 1fr)` — one column docked, up to
 * three on the full page, never overflowing a 360px viewport. Theme tokens throughout.
 */

export function StarterGroup({ heading, ariaLabel, children }: { heading: string; ariaLabel: string; children: React.ReactNode }) {
  return (
    <section style={{ width: '100%' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {heading}
      </h3>
      <div role="group" aria-label={ariaLabel} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 6 }}>
        {children}
      </div>
    </section>
  );
}

export interface StarterTileProps {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  /** Toggle tiles (a capability) show their armed state. */
  pressed?: boolean;
  disabled?: boolean;
}

export function StarterTile({ icon, label, hint, onClick, pressed, disabled }: StarterTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={hint}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 44,
        padding: '7px 10px', borderRadius: 'var(--radius-md)', textAlign: 'left',
        border: `1px solid ${pressed ? 'var(--accent)' : 'var(--border-subtle, rgba(128,128,128,0.3))'}`,
        background: pressed ? 'var(--accent-subtle, rgba(59,130,246,0.12))' : 'var(--bg-elevated, rgba(128,128,128,0.06))',
        color: 'var(--text-primary)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, display: 'inline-flex' }}><Icon source={icon} size={18} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hint}
        </span>
      </span>
    </button>
  );
}
