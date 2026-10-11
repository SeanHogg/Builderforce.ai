/**
 * The newest listed startups plus the two doors — what the investor-intelligence
 * explainer shows a visitor before they have read a word of copy. Diagnostics is
 * the platform's best CTA because it returns a result before asking anything;
 * this is the same move for the CEO's page. The same hook and the same card as
 * the storefront, with the filters left off.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StartupDoors } from './StartupDoors';
import { StartupPreview } from './StartupPreview';

const BROWSE_HREF = '/marketplace?family=company&kind=business';

export function StartupDirectoryTeaser() {
  const t = useTranslations('startups.directory');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StartupPreview limit={6} />
      <p style={{ margin: 0 }}>
        <Link href={BROWSE_HREF} className="ui-button ui-button--secondary">{t('browseAll')} →</Link>
      </p>
      <StartupDoors browseHref={`${BROWSE_HREF}&seekingInvestment=true`} />
    </div>
  );
}
