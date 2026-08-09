'use client';

/**
 * The index rail for a reference page opened as a panel (PRD 21 §11.4.5).
 *
 * A reference page is long — `/soc2` is a hero, a report mock, twenty control
 * cards, four steps, a family grid and a FAQ. Opened at full width over a board
 * that is still running, "scroll until you find the controls" is the wrong
 * interaction, so the panel offers the page's own sections as an index, exactly
 * as `ShellIndex` offers a destination's tabs.
 *
 * The sections are DECLARED on the registry row, not discovered from the DOM:
 * a rail built by querying for `<section id>` silently loses a row the day
 * somebody renames an id, and silently gains one the day a component nests a
 * section of its own. `check-destinations.mjs` asserts each declared id appears
 * in the page that owns it, so the two cannot drift.
 *
 * Anchor links rather than router pushes: the target is inside the panel's own
 * scroller, so this is a scroll, not a navigation, and it must not touch the
 * board behind it.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ReferenceSection } from '@/lib/navGroups';

export function ReferenceIndex({ sections }: { sections: ReferenceSection[] }) {
  const t = useTranslations('referencePanel.section');

  const scrollTo = useCallback((event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    // `nearest` rather than `start`: the panel body is the scroll container, and
    // `start` on a nested scroller drags the page behind it on some engines.
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  return (
    <nav className="ref-index" aria-label={t('label')}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="ref-index__item"
          onClick={(event) => scrollTo(event, section.id)}
        >
          {t(section.labelKey)}
        </a>
      ))}
    </nav>
  );
}

export default ReferenceIndex;
