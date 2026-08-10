import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import BurnrateDomainPage, { type BurnrateDomainCopy, type BurnrateSharedCopy } from '@/components/marketing/BurnrateDomainPage';
import { referenceBySlug } from '@/lib/navGroups';

export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ burnrateDomain: string }> }) {
  const { burnrateDomain } = await params;
  const domain = referenceBySlug(burnrateDomain);
  if (!domain) return {};
  const t = await getTranslations('burnrateMarketing');
  const copy = t.raw(`domains.${domain.copyId}`) as BurnrateDomainCopy;
  return { title: `${copy.title} | Builderforce.ai`, description: copy.description };
}

export default async function ConsolidatedDomainRoute({ params }: { params: Promise<{ burnrateDomain: string }> }) {
  const { burnrateDomain } = await params;
  const domain = referenceBySlug(burnrateDomain);
  if (!domain) notFound();
  const t = await getTranslations('burnrateMarketing');
  return <BurnrateDomainPage domain={domain} copy={t.raw(`domains.${domain.copyId}`) as BurnrateDomainCopy} shared={t.raw('shared') as BurnrateSharedCopy} />;
}
