import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StageLearningClient } from './StageLearningClient';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketplace.stageLearning');
  return {
    title: { absolute: `${t('title')} — Builderforce.ai` },
    description: t('metaDescription'),
    robots: { index: false, follow: true },
  };
}

/** `/marketplace/stage-learning` — stage courses and toolkit install (epic #2545). */
export default function StageLearningPage() {
  return <StageLearningClient />;
}
