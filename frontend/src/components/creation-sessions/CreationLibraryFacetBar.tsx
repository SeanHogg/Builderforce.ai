'use client';

import { useTranslations } from 'next-intl';
import { CREATION_LIBRARY_FACETS, creationLibraryFacetCounts, type CreationLibraryFacet, type CreationLibraryItem } from '@/domains/canvas/domain/creationLibrary';
import styles from './CreationLibraryFacetBar.module.css';

interface Props {
  /** Every item in the library BEFORE the facet filter — the counts have to include
   *  what pressing a chip would reveal, not only what is on screen now. */
  items: readonly CreationLibraryItem[];
  selected: CreationLibraryFacet | null;
  onSelect: (facet: CreationLibraryFacet | null) => void;
}

/**
 * The library's one facet control: WHAT KIND of thing, over a single list.
 *
 * The Create page used to answer that question with layout — a section of canvas
 * tiles, then a section of builds, then workflows, chats, projects and agents, each
 * with its own heading and its own row shape. That said the kinds were different
 * KINDS OF PLACE, which they are not: every row opens the same board. It also meant
 * the list could not be ordered by recency, because the sections came first.
 *
 * So the kind became a filter over one recency-ordered list, the same way the folder
 * bar filters it by folder — two facets, one library, and the sections are gone.
 *
 * It decides its own visibility, as every shared control here does: with one facet
 * present there is nothing to choose between, and a row of chips that cannot change
 * what is on screen is furniture. Empty facets are dropped for the same reason.
 */
export function CreationLibraryFacetBar({ items, selected, onSelect }: Props) {
  const t = useTranslations('creationCanvas');
  const counts = creationLibraryFacetCounts(items);
  const present = CREATION_LIBRARY_FACETS.filter((facet) => counts[facet] > 0);

  if (present.length < 2) return null;

  return (
    <div className={styles.bar} role="group" aria-label={t('facetLabel')}>
      <button
        type="button"
        className={styles.chip}
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        {t('facetAll')} <span className={styles.count}>{items.length}</span>
      </button>
      {present.map((facet) => (
        <button
          key={facet}
          type="button"
          className={styles.chip}
          aria-pressed={selected === facet}
          // Pressing the active chip clears it, so the filter is never a trap the
          // reader has to find an "all" button to escape.
          onClick={() => onSelect(selected === facet ? null : facet)}
        >
          {t(`facet.${facet}`)} <span className={styles.count}>{counts[facet]}</span>
        </button>
      ))}
    </div>
  );
}
