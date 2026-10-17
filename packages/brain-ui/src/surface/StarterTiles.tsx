import type { ReactNode } from 'react';

/**
 * The empty state's starting points — ONE tile and ONE group shape for every kind of
 * starter (onboarding, Work-mode jobs, "what are we making?" capabilities, the editor's
 * and Rovr's fixed starts), so the lists a person scans before the first message read
 * as one list on every host. Moved from the web Brain panel.
 *
 * A tile is a row (icon · label · one-line hint), not a card: in a ~340px docked column
 * cards showed two options above the fold; rows show the whole set. The grid is
 * `auto-fill` / `minmax(min(100%, 220px), 1fr)` — one column docked, up to three on a
 * full page, never overflowing a 360px viewport.
 */
export function StarterGroup({ heading, ariaLabel, children }: { heading: string; ariaLabel?: string; children: ReactNode }) {
  return (
    <section className="bf-starters">
      <h3 className="bf-starters__heading">{heading}</h3>
      <div role="group" aria-label={ariaLabel ?? heading} className="bf-starters__grid">
        {children}
      </div>
    </section>
  );
}

export interface StarterTileProps {
  /** The host's icon element (web `Icon`, an inline SVG) — never an emoji. */
  icon?: ReactNode;
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
      className="bf-starter"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={hint}
    >
      {icon != null && <span aria-hidden className="bf-starter__icon">{icon}</span>}
      <span className="bf-starter__text">
        <span className="bf-starter__label">{label}</span>
        <span className="bf-starter__hint">{hint}</span>
      </span>
    </button>
  );
}
