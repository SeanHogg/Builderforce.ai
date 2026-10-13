import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { capabilityAppFor } from '@/lib/marketplace/capabilityApps';
import { CapabilityAppView } from '@/components/marketplace/capability/CapabilityAppView';

/**
 * `/apps/<id>` — an installed capability app (PRD 33 §4.2 step 8). Which app is
 * data (`CAPABILITY_APPS`); what this workspace sees of it (the listing, set-up
 * or the app) is decided client-side by its entitlement.
 */
export const runtime = 'edge';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = capabilityAppFor(slug);
  if (!app) return { title: 'Not found', robots: { index: false, follow: false } };
  const t = await getTranslations('apps');
  return { title: t(`${app.nameKey}.name` as never), robots: { index: false, follow: false } };
}

export default async function CapabilityAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!capabilityAppFor(slug)) notFound();
  return <CapabilityAppView appId={slug} />;
}
