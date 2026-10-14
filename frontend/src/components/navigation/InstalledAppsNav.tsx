import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NavIcon } from './NavIcon';
import { useInstalledCapabilityApps } from '@/lib/marketplace/useInstalledCapabilityApps';

/**
 * "Apps" in the workspace rail — the capability apps this workspace installed
 * from the marketplace (PRD 33 §4.2 step 8). Its own component so the rail does
 * not learn what an installed app is; renders nothing until one exists.
 */
export function InstalledAppsNav({ pathname, collapsed, onNavigate }: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('apps');
  const apps = useInstalledCapabilityApps();
  if (apps.length === 0) return null;

  return (
    <div className="nav-stage" data-stage="apps" data-testid="installed-apps-nav">
      {!collapsed && <span className="ui-eyebrow nav-stage__label">{t('navTitle')}</span>}
      <div className="nav-stage__rows">
        {apps.map((app) => {
          const label = t(`${app.nameKey}.name` as never);
          const active = pathname === app.homePath || pathname.startsWith(`${app.homePath}/`);
          return (
            <Link
              key={app.id}
              href={app.homePath}
              onClick={onNavigate}
              className={`nav-item ${active ? 'active' : ''} flex items-center`}
              aria-current={active ? 'page' : undefined}
              data-label={label}
            >
              <span className="nav-item-icon"><NavIcon name={app.nameKey} /></span>
              <span className="nav-item-label">{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
