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
import { destTitleKey, publicDestinationFor } from '@/lib/publicDestinations';
import { seatHueVar } from '@/lib/seats';
import { ShellIndex, useShellDestination } from './ShellIndex';
import { useOwnReferenceRail, useReferenceChrome, useReferenceSelect, type ReferenceChromeSection } from '@/lib/referenceChrome';
import { useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';

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
 *
 * Labels arrive RESOLVED rather than as keys, because the two sources of a rail
 * key them differently: a registry row carries an i18n key under
 * `referencePanel.section`, and a page that publishes its own chrome
 * (`lib/referenceChrome`) has already translated its labels in its own
 * namespace. One list component, one label type, translated by whoever owns the
 * copy.
 */
function ReferenceIndex({ sections, label, activeId, onSelect }: {
  sections: ReferenceChromeSection[];
  label: string;
  /** Set only on a selector rail — which row is showing. */
  activeId?: string | undefined;
  /** Set when the page's sections are VIEWS rather than anchors. */
  onSelect?: ((id: string) => void) | undefined;
}) {
  // A tabbed reference page keeps one section in the DOM at a time, so its rail
  // cannot be a list of anchors — there is nothing to scroll to. It is a choice
  // instead, and it is spelled as buttons so it reads as one to a screen reader
  // too. Same component, because it is the same rail in the same place.
  if (onSelect) {
    return (
      <nav className="ref-index" aria-label={label}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className="ref-index__item"
            aria-current={section.id === activeId ? 'true' : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
    );
  }
  return <AnchorIndex sections={sections} label={label} />;
}

function AnchorIndex({ sections, label }: { sections: ReferenceChromeSection[]; label: string }) {
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
    <nav className="ref-index" aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="ref-index__item"
          onClick={(event) => scrollTo(event, section.id)}
        >
          {section.label}
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
  const tRefSection = useTranslations('referencePanel.section');
  const pathname = usePathname() || '';
  const router = useRouter();
  // The destination, not the active tab: the panel wants the crumb and whether
  // there is an index worth offering. Taking the query-reading hook here would
  // put a CSR bailout above the page slot for a value it never reads.
  const { group, items } = useShellDestination();
  const canvas = useOptionalActiveCanvas();
  const boardSessionId = canvas?.active?.sessionId ?? null;

  /**
   * Closing the panel is closing the PAGE — so it navigates to the BOARD, by id.
   *
   * It used to push the literal `/create`, which is itself a panel destination
   * (the canvas library). On every other route that read as "close", and on
   * `/create` it read as nothing at all: the push resolved to the route already
   * on screen, so the ✕ and the scrim and Escape were all inert and the only way
   * out of your own canvas list was the browser's Back button. The stage knows
   * which board it is holding; that is the thing to go back to.
   */
  const close = useCallback(
    () => router.push(boardSessionId ? `/create/${boardSessionId}` : '/create'),
    [boardSessionId, router],
  );

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

  // Every reference page names ITSELF, through `ReferencePage` — the title the
  // panel header shows and the sections its rail lists, from the same array the
  // page renders its anchored bands from. The registry row supplies the crumb,
  // the hue and a fallback title; it no longer holds a second copy of the
  // page's own structure, which is what stopped a page whose sections are DATA
  // (`/integrations`' categories, `/tools/<id>`'s diagnostics) from having a
  // rail at all.
  const published = useReferenceChrome();
  const selectSection = useReferenceSelect();
  const sections: ReferenceChromeSection[] | undefined = published?.sections?.length ? published.sections : undefined;
  // Tell the page its tabs are on screen already, so it can drop its own copy of
  // them. Only a SELECTOR rail replaces a control — an anchor rail is a table of
  // contents beside the page, not instead of anything in it.
  useOwnReferenceRail(sections != null && selectSection != null);

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
        published?.title ? published.title
        : reference ? tRoot(destTitleKey(reference))
        : group ? t(group.labelKey)
        : tPanel('title')
      }
      // An index of one is not a choice, and `DestinationIndex` already returns
      // null for it — so the column is offered only when there is something in it.
      index={
        sections
          ? (
            <ReferenceIndex
              sections={sections}
              label={tRefSection('label')}
              activeId={published?.activeId}
              onSelect={selectSection ?? undefined}
            />
          )
          : items.length > 1 ? <ShellIndex orientation="vertical" /> : undefined
      }
    >
      {/* `.panel-body` on BOTH branches, because the thing they share is the one
          that was missing: a page in here must measure the PANEL, not the window.
          `.ui-panel-body` is already a named container for exactly that reason,
          but the display type scale was still `vw`, so a hero rendered at its
          1920px size inside a 480px drawer and ran off the right edge. The class
          restates the scale in `cqi` — see globals.css.

          A reference page then adds `.ref-panel-body`: it brings its own
          full-bleed layout (hero, bands, wraps), so it drops the padding —
          padding it produced a marketing page with a 16px frame inside a panel,
          which reads as a mistake in both — and widens the marketing COLUMN's
          gutter so the hero stops running into the drawer's left border while
          the bands still paint edge to edge. */}
      <div className={reference ? 'panel-body ref-panel-body' : 'panel-body'}>
        {children}
      </div>
    </SlideOutPanel>
  );
}

export default ShellPanel;
