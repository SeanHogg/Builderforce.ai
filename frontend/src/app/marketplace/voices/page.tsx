import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { VoiceMarketplace } from '@/components/voice/VoiceMarketplace';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('voice.marketplace');
  return {
    title: { absolute: `${t('title')} — Builderforce.ai` },
    description: t('subtitle'),
    robots: { index: false, follow: true },
  };
}

/** `/marketplace/voices` — the voice marketplace (the same component the IDE mounts). */
export default function VoiceMarketplacePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <VoiceMarketplace />
    </main>
  );
}
