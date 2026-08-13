'use client';

import styles from './CreationCanvas.module.css';

/**
 * Search + chip filters for a canvas side panel.
 *
 * The Files library grew this shape first (a search input over a grid of
 * aria-pressed chips, scoped to the values actually present in the data). The
 * outline needs the identical control, so the markup, the classes and the
 * pressed-state semantics live here once rather than being re-typed per panel —
 * otherwise the two panels drift into filtering and announcing themselves
 * differently, which is exactly the kind of divergence assistive technology
 * surfaces first.
 *
 * Every string arrives already localized from the caller: the two panels live in
 * different message namespaces (`creationCanvas.files` and `creationCanvas`), so
 * a shared component that picked its own namespace would force one of them to
 * duplicate its copy into the other's.
 */
export interface CanvasPanelFilterChip {
  /** Stable value written back through `onFilterChange`. */
  value: string;
  /** Already-localized visible label. */
  label: string;
}

export function CanvasPanelFilters({
  search, onSearchChange, searchLabel,
  chips, filter, onFilterChange, filterGroupLabel,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  /** Used as both the accessible name and the placeholder. */
  searchLabel: string;
  /** Omit (or pass fewer than two) to render search alone — one chip filters nothing. */
  chips?: readonly CanvasPanelFilterChip[];
  filter?: string;
  onFilterChange?: (value: string) => void;
  filterGroupLabel?: string;
}) {
  const showChips = !!chips && chips.length > 1 && !!onFilterChange;
  return (
    <div className={styles.panelControls}>
      {/* Deliberately NOT type="search": that maps to the `searchbox` ARIA role
          rather than `textbox`, which silently changes what assistive technology
          announces for a control the Files panel has shipped for a while. */}
      <input
        className={styles.panelSearch}
        value={search}
        aria-label={searchLabel}
        placeholder={searchLabel}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {showChips && (
        <div className={styles.panelFilters} role="group" aria-label={filterGroupLabel}>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={filter === chip.value}
              onClick={() => onFilterChange(chip.value)}
            >{chip.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
