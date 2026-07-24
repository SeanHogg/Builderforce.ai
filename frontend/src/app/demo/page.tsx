import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import MarketingDeck from '@/components/marketing/MarketingDeck';
import { DemoShowcase } from '@/components/demo/DemoShowcase';
import { pageMetadata } from '@/lib/seo';
import { BRAND } from '@/lib/content';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketingDeck.seo');
  return pageMetadata({
    title: t('title'),
    description: t('description'),
    path: '/demo',
    ogTitle: t('ogTitle'),
  });
}

interface DeckSlide {
  kind: 'intro' | 'scenario' | 'outro';
  chapter?: string;
  eyebrow: string;
  title: string;
  tagline: string;
  steps?: string[];
  see?: string;
}

/**
 * /demo — the guided "ultimate demo" deck. A thin server page (edge, SEO,
 * JSON-LD) around the client-side {@link MarketingDeck} that does the paging,
 * followed by {@link DemoShowcase} so a visitor can jump straight into a live,
 * signed-in persona demo workspace from the same page. The crawler-facing HowTo
 * schema is derived from the SAME localized slides the deck renders, so the
 * structured data never drifts from the on-screen copy.
 */
export default async function DemoPage() {
  const t = await getTranslations('marketingDeck');
  const slides = t.raw('slides') as DeckSlide[];

  const howTo = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: t('seo.title'),
    description: t('seo.description'),
    publisher: { '@type': 'Organization', name: BRAND.name, url: BRAND.url },
    step: slides
      .filter((s) => s.kind === 'scenario')
      .map((s, idx) => ({
        '@type': 'HowToStep',
        position: idx + 1,
        name: s.title,
        text: s.see ? `${s.tagline} ${s.see}` : s.tagline,
      })),
  };

  return (
    <>
      <JsonLd data={howTo} />
      <MarketingDeck />
      <DemoShowcase />
      <RelatedArticles surface="product" />
    </>
  );
}
