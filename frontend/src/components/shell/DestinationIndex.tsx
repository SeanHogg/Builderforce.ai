'use client';

/**
 * THE index (PRD 21 §3.4, §4 of the sequence).
 *
 * Three components went in and one came out: `SectionTabs` (the shell's
 * destination bar), `PillTabs` (in-page sub-views) and `AdminGroupNav` (a thin
 * adapter over `PillTabs`) were the same list rendered three ways, which is the
 * disease §2.6 rule 3 names — so they are deleted and every caller renders this.
 *
 * IT DECIDES ITS OWN ORIENTATION, and that is the whole reason it can replace a
 * tab bar. A caller does not get to pick wrong.
 *
 * The rule CHANGED (operator decision, 2026-08-12). §6.3 used to say "no
 * horizontal tab bar renders more than 6 items anywhere", so an index of seven
 * flipped to a vertical column — which is how Settings' eight sub-views ended up
 * as a list down the middle of the page instead of tabs across the top of it.
 * The constraint §6.3 was actually protecting is *an over-long bar must not wrap
 * into an unreadable block*, and wrapping is not the only answer to that: past
 * the row limit this now becomes a single-line SCROLLING tab strip
 * (`data-scroll="true"`), which keeps every sub-view a tab at the top and still
 * never stacks. The vertical column survives as an EXPLICIT orientation, because
 * the shell panel's index rail genuinely is a column beside the body.
 *
 * One rule, one place — so no caller had to change, and a fifteenth sub-view
 * cannot quietly re-create either failure.
 *
 * It also decides its own VISIBILITY (a single item is not a choice, so it
 * renders nothing) and its own LOCKED state — a locked destination stays visible
 * and disabled with a reason rather than disappearing (§2.6 rule 7). Neither is
 * a prop the caller could have computed and drifted on.
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Above this many items a WRAPPING row stops being navigable, so the strip
 *  scrolls on one line instead of wrapping onto several. */
export const INDEX_ROW_LIMIT = 6;

export interface IndexItem {
  /** Stable id used for the active comparison ('' = a destination's default view). */
  id: string;
  label: string;
  icon?: string;
  href: string;
  /** Optional group heading rendered above this item in the vertical column
   *  ("You" vs "Workspace" in Settings; "People / Working / Measure" in
   *  Workforce) — grouped by the question a person is actually asking. */
  group?: string;
  /** Count badge, e.g. open tickets on a tab. */
  badge?: ReactNode;
  /** Visible and disabled, with `lockedReason` as its title. */
  locked?: boolean;
  lockedReason?: string;
}

export type IndexOrientation = 'auto' | 'horizontal' | 'vertical';

/** The one place orientation is decided. Exported so the rule is testable rather
 *  than inferred from a rendered DOM. A nested sub-menu is ALWAYS a tab row at
 *  the top; only a caller that owns a column (the shell panel's rail) asks for
 *  one, and it asks explicitly. */
export function resolveOrientation(requested: IndexOrientation, _count: number): 'horizontal' | 'vertical' {
  return requested === 'auto' ? 'horizontal' : requested;
}

/** Whether the row scrolls on one line instead of wrapping onto several. The
 *  same threshold §6.3 named, applied to the failure it was actually about. */
export function indexScrolls(orientation: 'horizontal' | 'vertical', count: number): boolean {
  return orientation === 'horizontal' && count > INDEX_ROW_LIMIT;
}

export function DestinationIndex({
  items,
  activeId,
  ariaLabel,
  orientation = 'auto',
  style,
}: {
  items: IndexItem[];
  activeId: string;
  ariaLabel: string;
  orientation?: IndexOrientation;
  style?: CSSProperties;
}) {
  // One destination is not a choice — self-hides so no caller has to gate it.
  if (items.length <= 1) return null;

  const resolved = resolveOrientation(orientation, items.length);
  let lastGroup: string | undefined;

  return (
    <nav
      className="ui-index"
      data-orientation={resolved}
      data-scroll={indexScrolls(resolved, items.length) ? 'true' : undefined}
      aria-label={ariaLabel}
      style={style}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        // The grouping ("You" vs "Workspace") is information, not decoration, so
        // it survives the turn to a row — as an inline caption before the first
        // tab of each group rather than as a heading above a column.
        const heading = item.group && item.group !== lastGroup ? item.group : undefined;
        lastGroup = item.group;
        const body = (
          <>
            {item.icon && <Icon source={item.icon} size={16} />}
            <span>{item.label}</span>
            {item.badge}
          </>
        );
        return (
          <span key={item.id || 'default'} style={{ display: 'contents' }}>
            {heading && <span className="ui-index__group">{heading}</span>}
            {item.locked ? (
              <span
                className="ui-index__item"
                aria-disabled="true"
                title={item.lockedReason}
              >
                {body}
              </span>
            ) : (
              <Link
                href={item.href}
                className="ui-index__item"
                aria-current={active ? 'page' : undefined}
              >
                {body}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default DestinationIndex;
