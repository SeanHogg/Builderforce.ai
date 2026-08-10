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
 * tab bar. §6.3 requires that "no horizontal tab bar renders more than 6 items
 * anywhere", and Workforce has fourteen sub-views. A caller does not get to pick
 * wrong: at or under the threshold this is a compact row, above it a vertical
 * index column. One rule, one place, so a fifteenth sub-view cannot quietly
 * re-create the over-long bar.
 *
 * It also decides its own VISIBILITY (a single item is not a choice, so it
 * renders nothing) and its own LOCKED state — a locked destination stays visible
 * and disabled with a reason rather than disappearing (§2.6 rule 7). Neither is
 * a prop the caller could have computed and drifted on.
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Above this many items a horizontal bar stops being navigable — §6.3's rule. */
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
 *  than inferred from a rendered DOM. */
export function resolveOrientation(requested: IndexOrientation, count: number): 'horizontal' | 'vertical' {
  if (requested !== 'auto') return requested;
  return count > INDEX_ROW_LIMIT ? 'vertical' : 'horizontal';
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
    <nav className="ui-index" data-orientation={resolved} aria-label={ariaLabel} style={style}>
      {items.map((item) => {
        const active = item.id === activeId;
        const heading = resolved === 'vertical' && item.group && item.group !== lastGroup ? item.group : undefined;
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
