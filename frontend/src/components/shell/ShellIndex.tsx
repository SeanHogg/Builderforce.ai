'use client';

/**
 * The active destination's sub-views, as an index (PRD 21 §3.4).
 *
 * This is what `SectionTabs` was — it self-decides from the route which primary
 * destination is active and lists that destination's sub-views — with the two
 * changes the PRD makes: it renders through the one `DestinationIndex`
 * primitive, and it can be asked for the vertical form so a panel can carry it
 * as an index COLUMN instead of a bar nobody can read at fourteen items.
 *
 * `useShellDestination()` is exported separately because the panel needs the
 * group's label for its crumb, and re-deriving "which destination am I on"
 * beside this component is exactly the drift the file exists to prevent.
 *
 * ── WHY THE QUERY READ IS A SEPARATE HOOK ───────────────────────────────────
 * `useSearchParams()` opts every tree above it into a Suspense requirement, and
 * this component renders in `AppShell` ABOVE the layout's one page-slot
 * boundary. So a statically prerendered page failed the build outright
 * ("useSearchParams() should be wrapped in a suspense boundary at page
 * /freelancer/timecard") — the shell chrome was reading the query with nothing
 * above it to bail into, and every page without `runtime = 'edge'` inherited it.
 *
 * The split is what fixes it rather than a blanket boundary: only a QUERY group
 * ("which `?tab=` am I on") needs the URL's query, and only that path suspends —
 * behind a boundary this component owns, whose fallback is the same bar with no
 * tab marked active. A route group's active sub-view is the PATH, so it still
 * prerenders whole, and `ShellPanel` — which wants the destination, never the
 * active tab — no longer opts in at all.
 */

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getStoredTenant } from '@/lib/auth';
import { useNavGroups } from '@/lib/destinations/useDestinations';
import { findActiveGroup, activeRouteTabId, tabHref, type NavGroup } from '@/lib/navGroups';
import { useNavCounts } from '@/lib/navCounts';
import { TabCountBadge } from '@/components/TabCountBadge';
import { DestinationIndex, type IndexItem, type IndexOrientation } from './DestinationIndex';

export interface ShellDestinationModel {
  group: NavGroup | undefined;
  items: IndexItem[];
  /**
   * The active sub-view for a ROUTE group, which is the path itself. Empty for a
   * query group — that answer lives in `?tab=` and only `useShellIndex()` reads it.
   */
  routeActiveId: string;
}

export interface ShellIndexModel extends ShellDestinationModel {
  activeId: string;
}

/**
 * The destination on screen and its sub-views — derived from the path and the
 * account's own registry, with no query read, so a caller needs no Suspense
 * boundary above it.
 */
export function useShellDestination(): ShellDestinationModel {
  const t = useTranslations('nav');
  const pathname = usePathname() || '';
  const counts = useNavCounts();
  // THIS account's rows, not the builder registry's. Resolving against the
  // builder set meant a restricted account had no active destination at all, and
  // the two consequences were patched separately: a freelancer branch here
  // blanked the index outright, to stop it offering tenant-only tabs that bounce
  // the account. Asking the right registry answers both — a freelancer's rows
  // are, by construction, the ones a freelancer may reach — so the branch is
  // gone rather than kept beside the fix.
  const groups = useNavGroups();
  const group = findActiveGroup(pathname, groups);

  if (!group?.tabs?.length) return { group, items: [], routeActiveId: '' };

  const isOwner = getStoredTenant()?.role === 'owner';
  const items: IndexItem[] = group.tabs
    .filter((tab) => !tab.ownerOnly || isOwner)
    .map((tab) => ({
      // For a query group `id` is the `?tab=` value; for a route group it IS the
      // path, which is also what `activeRouteTabId` returns — so one field.
      id: tab.id,
      label: t(tab.labelKey),
      icon: tab.icon,
      href: tabHref(group, tab),
      badge: tab.countKey ? <TabCountBadge count={counts[tab.countKey]} /> : undefined,
    }));

  return {
    group,
    items,
    routeActiveId: group.tabKind === 'query' ? '' : (activeRouteTabId(group, pathname) ?? ''),
  };
}

/**
 * …plus which sub-view is active, `?tab=` included.
 *
 * Reads the query, so every caller needs a Suspense boundary above it. `ShellIndex`
 * owns one; nothing else should call this hook without providing its own.
 */
export function useShellIndex(): ShellIndexModel {
  const destination = useShellDestination();
  const searchParams = useSearchParams();
  return {
    ...destination,
    activeId: destination.group?.tabKind === 'query'
      ? (searchParams.get('tab') ?? '')
      : destination.routeActiveId,
  };
}

/** The bar itself, told which sub-view to mark active. */
function ShellIndexBar({ activeId, orientation }: { activeId: string; orientation: IndexOrientation }) {
  const t = useTranslations('nav');
  const { group, items } = useShellDestination();
  if (!group || items.length === 0) return null;

  return (
    <DestinationIndex
      items={items}
      activeId={activeId}
      ariaLabel={t(group.labelKey)}
      orientation={orientation}
      style={orientation === 'auto' || orientation === 'horizontal' ? { marginBottom: 0 } : undefined}
    />
  );
}

/** The `?tab=` reader — the only part of the index that suspends. */
function ShellIndexQueryBar({ orientation }: { orientation: IndexOrientation }) {
  const { activeId } = useShellIndex();
  return <ShellIndexBar activeId={activeId} orientation={orientation} />;
}

export function ShellIndex({ orientation = 'auto' }: { orientation?: IndexOrientation }) {
  const { group, routeActiveId } = useShellDestination();
  if (group?.tabKind !== 'query') return <ShellIndexBar activeId={routeActiveId} orientation={orientation} />;

  return (
    <Suspense fallback={<ShellIndexBar activeId="" orientation={orientation} />}>
      <ShellIndexQueryBar orientation={orientation} />
    </Suspense>
  );
}

export default ShellIndex;
