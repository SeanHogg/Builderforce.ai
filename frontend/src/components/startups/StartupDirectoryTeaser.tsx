'use client';

/**
 * The newest listed startups plus the two doors — what the investor-intelligence
 * explainer shows a visitor before they have read a word of copy. Diagnostics is
 * the platform's best CTA because it returns a result before asking anything;
 * this is the same move for the CEO's page. The same hook and the same card as
 * the storefront, with the filters left off.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StartupCard } from './StartupCard';
import { StartupDoors } from './StartupDoors';
import { ExpressInterestPanel } from './ExpressInterestPanel';
import { useStartupDirectory } from './useStartupDirectory';
import { startupMutedStyle } from './startupStyles';

const BROWSE_HREF = '/marketplace?family=company&kind=business';

export function StartupDirectoryTeaser() {
  const t = useTranslations('startups.directory');
  const directory = useStartupDirectory({ limit: 6 });
  const startups = directory.page?.startups ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {startups.length > 0 && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}>
          {startups.map((startup) => <StartupCard key={startup.slug} startup={startup} onInquire={directory.openInquiry} />)}
        </div>
      )}
      {!directory.loading && startups.length === 0 && (
        <p style={startupMutedStyle}>{t('empty')}</p>
      )}
      <p style={{ margin: 0 }}>
        <Link href={BROWSE_HREF} className="ui-button ui-button--secondary">{t('browseAll')} →</Link>
      </p>
      <StartupDoors browseHref={`${BROWSE_HREF}&seekingInvestment=true`} />
      <ExpressInterestPanel
        open={directory.inquiring != null}
        onClose={directory.closeInquiry}
        company={directory.inquiring ? { slug: directory.inquiring.slug, name: directory.inquiring.name } : null}
      />
    </div>
  );
}
