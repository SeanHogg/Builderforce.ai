import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import BurnrateDomainPage, { type BurnrateDomainCopy, type BurnrateSharedCopy } from '@/components/marketing/BurnrateDomainPage';
import { REFERENCE_FOUNDATIONS } from '@/lib/publicDestinations';

export const runtime = 'edge';

export default async function ConsolidatedFeatureRoute({ params }: { params: Promise<{ burnrateFeature: string }> }) {
  const { burnrateFeature } = await params;
  const domain = REFERENCE_FOUNDATIONS.find((entry) => entry.marketingHref === `/features/${burnrateFeature}`);
  if (!domain) notFound();
  const t = await getTranslations('burnrateMarketing');
  return <BurnrateDomainPage domain={domain} copy={t.raw(`domains.${domain.copyId}`) as BurnrateDomainCopy} shared={t.raw('shared') as BurnrateSharedCopy} />;
}
