import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { capabilityAppFor } from '@/lib/marketplace/capabilityApps';
import { CapabilitySetup } from '@/components/marketplace/capability/CapabilitySetup';

/**
 * `/apps/<id>/setup` — the ONE set-up page for a capability app (PRD 33 §4.2
 * steps 3–7): workspace + install, site, snippet, verify, plan. Served for
 * `/apps/insights/setup`; a dynamic segment rather than `app/apps/insights/`,
 * because a static `insights` folder would shadow `/apps/[slug]` for
 * `/apps/insights` itself.
 */
export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = capabilityAppFor(slug);
  if (!app) return { title: 'Not found', robots: { index: false, follow: false } };
  const t = await getTranslations('marketplace.capability');
  const tApps = await getTranslations('apps');
  return { title: t('setupTitle', { app: tApps(`${app.nameKey}.name` as never) }), robots: { index: false, follow: false } };
}

export default async function CapabilitySetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!capabilityAppFor(slug)) notFound();
  return <CapabilitySetup appId={slug} />;
}
