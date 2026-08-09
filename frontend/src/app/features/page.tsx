import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BURNRATE_FOUNDATIONS, BURNRATE_PRODUCT_DOMAINS } from '@/lib/burnrateCatalog';
import type { BurnrateDomainCopy } from '@/components/marketing/BurnrateDomainPage';
import { Icon } from '@/components/ui/Icon';

export default async function FeaturesPage() {
  const t = await getTranslations('burnrateMarketing');
  const renderEntries = (entries: typeof BURNRATE_PRODUCT_DOMAINS) => entries.map((domain) => {
    const copy = t.raw(`domains.${domain.id}`) as BurnrateDomainCopy;
    return <Link href={domain.marketingHref} key={domain.id} className="br-feature-index__card">
      <span><Icon source={domain.icon} size={24} /></span><small>{domain.persona}</small><h2>{copy.title}</h2><p>{copy.tagline}</p><b>{t('index.explore')} →</b>
    </Link>;
  });
  return <main className="br-feature-index">
    <header><p>{t('index.eyebrow')}</p><h1>{t('index.title')}</h1><div>{t('index.description')}</div></header>
    <section><h2>{t('index.domains')}</h2><div className="br-feature-index__grid">{renderEntries(BURNRATE_PRODUCT_DOMAINS)}</div></section>
    <section><h2>{t('index.foundations')}</h2><div className="br-feature-index__grid">{renderEntries(BURNRATE_FOUNDATIONS)}</div></section>
  </main>;
}
