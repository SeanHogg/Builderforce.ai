import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import BurnrateDomainPage, { type BurnrateDomainCopy, type BurnrateSharedCopy } from '@/components/marketing/BurnrateDomainPage';
import { BURNRATE_FOUNDATIONS } from '@/lib/burnrateCatalog';

export function generateStaticParams() {
  return BURNRATE_FOUNDATIONS.filter((domain) => domain.marketingHref.startsWith('/features/')).map((domain) => ({ burnrateFeature: domain.marketingHref.split('/').at(-1) }));
}

export default async function ConsolidatedFeatureRoute({ params }: { params: Promise<{ burnrateFeature: string }> }) {
  const { burnrateFeature } = await params;
  const domain = BURNRATE_FOUNDATIONS.find((entry) => entry.marketingHref === `/features/${burnrateFeature}`);
  if (!domain) notFound();
  const t = await getTranslations('burnrateMarketing');
  return <BurnrateDomainPage domain={domain} copy={t.raw(`domains.${domain.id}`) as BurnrateDomainCopy} shared={t.raw('shared') as BurnrateSharedCopy} />;
}
