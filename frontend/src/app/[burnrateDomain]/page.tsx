import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import BurnrateDomainPage, { type BurnrateDomainCopy, type BurnrateSharedCopy } from '@/components/marketing/BurnrateDomainPage';
import { BURNRATE_PRODUCT_DOMAINS, burnrateDomainBySlug } from '@/lib/burnrateCatalog';

export const runtime = 'edge';

export function generateStaticParams() {
  return BURNRATE_PRODUCT_DOMAINS.map((domain) => ({ burnrateDomain: domain.marketingHref.slice(1) }));
}

export async function generateMetadata({ params }: { params: Promise<{ burnrateDomain: string }> }) {
  const { burnrateDomain } = await params;
  const domain = burnrateDomainBySlug(burnrateDomain);
  if (!domain || domain.kind !== 'domain') return {};
  const t = await getTranslations('burnrateMarketing');
  const copy = t.raw(`domains.${domain.id}`) as BurnrateDomainCopy;
  return { title: `${copy.title} | Builderforce.ai`, description: copy.description };
}

export default async function ConsolidatedDomainRoute({ params }: { params: Promise<{ burnrateDomain: string }> }) {
  const { burnrateDomain } = await params;
  const domain = burnrateDomainBySlug(burnrateDomain);
  if (!domain || domain.kind !== 'domain') notFound();
  const t = await getTranslations('burnrateMarketing');
  return <BurnrateDomainPage domain={domain} copy={t.raw(`domains.${domain.id}`) as BurnrateDomainCopy} shared={t.raw('shared') as BurnrateSharedCopy} />;
}
