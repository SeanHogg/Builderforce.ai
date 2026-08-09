'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useIsFreelancer, useIsSalesAssociate } from '@/lib/rbac';
import { isNavItemActive } from '@/lib/nav';
import { MASCOT_ICON, bottomNavFor } from '@/lib/navGroups';
import MascotIcon from './MascotIcon';
import { Icon } from '@/components/ui/Icon';
import { useNavigationFeatures } from '@/lib/NavigationFeaturesContext';
import { navigationFeatureForPath } from '@/lib/navigationFeatures';

/**
 * The item table lives in `lib/navGroups.ts` (the registry) rather than here.
 * It was a fifth list of hrefs and labels, and `check-destinations.mjs` found
 * it — a destination declared beside the component that renders it is exactly
 * how this product arrived at seven of them.
 */

/**
 * Persistent mobile-only bottom navigation (hidden ≥768px via CSS). Self-gating
 * and auth/account-type/role-aware — renders the right five destinations for the
 * current viewer with no props.
 */
export default function MobileBottomNav() {
  const pathname = usePathname() || '';
  const { isAuthenticated, user } = useAuth();
  const isFreelancer = useIsFreelancer();
  const isSales = useIsSalesAssociate();
  const t = useTranslations('nav');
  const { enabled } = useNavigationFeatures();
  const items = bottomNavFor(isAuthenticated, !!user?.isSuperadmin, isFreelancer, isSales)
    .filter((item) => {
      const feature = navigationFeatureForPath(item.href);
      return !feature || enabled.has(feature);
    });

  return (
    <nav className="mobile-bottom-nav" aria-label={t('primaryAria')}>
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mbn-item${active ? ' active' : ''}${item.accent ? ' mbn-accent' : ''}`}
            aria-current={active ? 'page' : undefined}
            // Stable anchor for the demo product tour — first path segment matches
            // the sidebar nav ids / TourAnchor (e.g. /workforce → "workforce").
            data-tour={item.href.replace(/^\//, '').split('/')[0]}
          >
            <span className="mbn-icon" aria-hidden="true">
              {item.icon === MASCOT_ICON ? <MascotIcon size={22} /> : <Icon source={item.icon} size={21} />}
            </span>
            <span className="mbn-label">{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
