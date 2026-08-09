'use client';

/**
 * A destination, opened OVER the board that stays mounted (PRD 21 §0, §3.4).
 *
 * "**A route may change what is on screen. It may never unmount the stage.**"
 * That is the whole mechanism: the route still renders — unchanged, no page
 * component is rewritten to live here — but it renders inside the house panel
 * primitive instead of replacing the canvas. An in-flight agent turn, a peer
 * cursor, presence and an active call all belong to the session, and the session
 * outlives the navigation.
 *
 * Three things it decides rather than accepts:
 *
 *  - **Its width**, from `panelWidth(pathname)` — one of the three named widths
 *    (§2.4) and never a fourth invented at a call site.
 *  - **Its index column**, from `ShellIndex` — the destination's sub-views as a
 *    vertical list, which is what replaced the horizontal bar that could not
 *    hold Workforce's fourteen.
 *  - **Its crumb and title**, from the active nav group, so a panel over a board
 *    still says where you are without a page breadcrumb to sit in.
 *
 * Closing the panel is closing the PAGE — the board is what you go back to.
 */

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { panelWidth } from '@/lib/workbenchPolicy';
import { destTitleKey, publicDestinationFor } from '@/lib/navGroups';
import { seatHueVar } from '@/lib/seats';
import { ShellIndex, useShellIndex } from './ShellIndex';
import type { ReferenceSection } from '@/lib/navGroups';

/**
 * The index rail for a reference page opened as a panel (§11.4.5).
 *
 * A reference page is long — `/soc2` is a hero, a report mock, twenty control
 * cards, four steps, a family grid and a FAQ. Opened at full width over a board
 * that is still running, "scroll until you find the controls" is the wrong
 * interaction, so the panel offers the page's own sections as an index, exactly
 * as `ShellIndex` offers a destination's tabs.
 *
 * The sections are DECLARED on the registry row, not discovered from the DOM: a
 * rail built by querying for `<section id>` silently loses a row the day
 * somebody renames an id, and silently gains one the day a component nests a
 * section of its own. `check-destinations.mjs` asserts each declared id appears
 * in the page that owns it, so the two cannot drift.
 *
 * It lives here rather than in a file of its own because it has exactly one
 * consumer and this file is already a client component — a second `'use client'`
 * module for forty lines is what the architecture ratchet counts.
 */
function ReferenceIndex({ sections }: { sections: ReferenceSection[] }) {
  const t = useTranslations('referencePanel.section');

  // Anchor links rather than router pushes: the target is inside the panel's own
  // scroller, so this is a scroll, not a navigation, and it must not touch the
  // board behind it. `nearest` rather than `start` for the same reason — `start`
  // on a nested scroller drags the page behind it on some engines.
  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

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

export function ShellPanel({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tRoot = useTranslations();
  const tPanel = useTranslations('shellPanel');
  const tRef = useTranslations('referencePanel');
  const pathname = usePathname() || '';
  const router = useRouter();
  const { group, items } = useShellIndex();

  const close = useCallback(() => router.push('/create'), [router]);

  // A reference page has no nav group — it is an explainer, not a destination —
  // so without this it opened under the generic panel crumb with no title and no
  // index, which is the "looks nothing like the mockup" complaint exactly. Its
  // chrome comes from the registry row instead: the owning seat as the crumb, the
  // destination's own title, its hue on the panel, and its sections as the index.
  // `panel: false` rows (the canvas, the blog, the storefront) are public pages
  // that never open over a board, so they must not claim the panel's chrome even
  // if a route ever reaches here.
  const publicRow = publicDestinationFor(pathname);
  const reference = publicRow?.panel ? publicRow : undefined;

  return (
    <SlideOutPanel
      open
      onClose={close}
      width={panelWidth(pathname)}
      // Per destination, not per session: widening Finance must not widen
      // Settings. Falls back to the pathname for a route with no nav group,
      // which is still stable enough to remember.
      widthStorageKey={group?.id ?? reference?.id ?? pathname}
      accentVar={reference ? seatHueVar(reference.seat) : undefined}
      crumb={reference ? tRef('crumb', { seat: reference.seat }) : tPanel('crumb')}
      title={
        reference ? tRoot(destTitleKey(reference))
        : group ? t(group.labelKey)
        : tPanel('title')
      }
      // An index of one is not a choice, and `DestinationIndex` already returns
      // null for it — so the column is offered only when there is something in it.
      index={
        reference?.sections?.length
          ? <ReferenceIndex sections={reference.sections} />
          : items.length > 1 ? <ShellIndex orientation="vertical" /> : undefined
      }
    >
      {/* A reference page brings its own full-bleed layout (hero, bands, wraps),
          so it gets no panel padding — padding it produced a marketing page with
          a 16px gutter inside a panel, which reads as a mistake in both. */}
      <div style={reference ? undefined : { padding: 'var(--space-4)' }}>{children}</div>
    </SlideOutPanel>
  );
}

export default ShellPanel;
