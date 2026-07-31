'use client';

/**
 * Inner sub-tab bar for a Platform Admin group (e.g. Users → Directory ·
 * Security · Emulation). Rendered by the admin page BELOW the shell's top
 * <SectionTabs> group bar. A thin adapter over the shared <PillTabs> primitive
 * so the pill/segmented look never drifts from Settings / Security. Self-hides
 * for single-sub groups (PillTabs returns null) so the caller never has to gate it.
 */

import { useTranslations } from 'next-intl';
import PillTabs from '@/components/PillTabs';
import { adminSubHref, type AdminGroupMeta } from '@/lib/adminGroups';

export default function AdminGroupNav({
  group,
  activeSubId,
}: {
  group: AdminGroupMeta;
  activeSubId: string;
}) {
  const t = useTranslations('admin');

  return (
    <PillTabs
      ariaLabel={`${group.id} sub-views`}
      activeId={activeSubId}
      tabs={group.subs.map((sub) => ({
        id: sub.id,
        label: t(`sub.${sub.subKey}`),
        icon: sub.icon,
        href: adminSubHref(group.id, sub.id),
      }))}
      style={{ marginBottom: 20 }}
    />
  );
}
