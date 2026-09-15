'use client';

/**
 * The two doors under the directory — BurnRateOS's "Ready to connect?" band:
 * browse as an investor, or list your own startup.
 *
 * ONE component for the marketplace section and the explainer's teaser, so the
 * founder's door has one address everywhere. Signed in it goes straight to the
 * listing wizard; signed out it carries `intent=startup` through registration,
 * which is what picks the register page's startup panel and its landing.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { registerHref } from '@/lib/auth';
import { startupGhostButtonStyle, startupPrimaryButtonStyle } from './startupStyles';

/** Where a founder goes to list their startup. One string, imported by every door. */
export const LIST_YOUR_STARTUP_HREF = '/investor?tab=listing&start=1';
export const STARTUP_REGISTER_INTENT = 'startup';

/** The founder's door, resolved for the current visitor. */
export function useListYourStartupHref(): string {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? LIST_YOUR_STARTUP_HREF : registerHref(LIST_YOUR_STARTUP_HREF, STARTUP_REGISTER_INTENT);
}

export function StartupDoors({ onBrowseRaising, browseHref }: { onBrowseRaising?: () => void; browseHref?: string }) {
  const t = useTranslations('startups.directory');
  const listHref = useListYourStartupHref();
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))' }}>
      <Door
        eyebrow={t('forInvestors')}
        title={t('investorsTitle')}
        body={t('investorsBody')}
        action={onBrowseRaising
          ? <button type="button" style={startupGhostButtonStyle} onClick={onBrowseRaising}>{t('browseRaising')}</button>
          : <Link href={browseHref ?? '/marketplace?family=company&kind=business'} style={{ ...startupGhostButtonStyle, textDecoration: 'none', display: 'inline-flex', justifyContent: 'center' }}>{t('browseRaising')}</Link>}
      />
      <Door
        eyebrow={t('forStartups')}
        title={t('startupsTitle')}
        body={t('startupsBody')}
        action={<Link href={listHref} style={{ ...startupPrimaryButtonStyle, textDecoration: 'none', display: 'inline-flex', justifyContent: 'center' }}>{t('createProfile')}</Link>}
      />
    </div>
  );
}

function Door({ eyebrow, title, body, action }: { eyebrow: string; title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="ui-surface ui-surface--pad-md" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <p className="ui-eyebrow" style={{ margin: 0 }}>{eyebrow}</p>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{body}</p>
      <div>{action}</div>
    </div>
  );
}
