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
 * `useShellIndex()` is exported separately because the panel needs the group's
 * label for its crumb, and re-deriving "which destination am I on" beside this
 * component is exactly the drift the file exists to prevent.
 */

import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getStoredTenant } from '@/lib/auth';
import { useNavGroups } from '@/lib/destinations/useDestinations';
import { findActiveGroup, activeRouteTabId, tabHref, type NavGroup } from '@/lib/navGroups';
import { useNavCounts } from '@/lib/navCounts';
import { TabCountBadge } from '@/components/TabCountBadge';
import { DestinationIndex, type IndexItem, type IndexOrientation } from './DestinationIndex';

export interface ShellIndexModel {
  group: NavGroup | undefined;
  items: IndexItem[];
  activeId: string;
}

export function useShellIndex(): ShellIndexModel {
  const t = useTranslations('nav');
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
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

  if (!group?.tabs?.length) return { group, items: [], activeId: '' };

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

  const activeId = group.tabKind === 'query'
    ? (searchParams.get('tab') ?? '')
    : (activeRouteTabId(group, pathname) ?? '');

  return { group, items, activeId };
}

export function ShellIndex({ orientation = 'auto' }: { orientation?: IndexOrientation }) {
  const t = useTranslations('nav');
  const { group, items, activeId } = useShellIndex();
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

export default ShellIndex;
