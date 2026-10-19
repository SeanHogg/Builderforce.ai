import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdvisoryClient } from './AdvisoryClient';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('advisory');
  return {
    title: { absolute: `${t('title')} — Builderforce.ai` },
    description: t('metaDescription'),
    robots: { index: false, follow: true },
  };
}

/** `/advisory` — founder booking surface for epic #2545. */
export default function AdvisoryPage() {
  return <AdvisoryClient />;
}
