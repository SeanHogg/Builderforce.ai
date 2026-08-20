import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import CatalogArtifactActions from '@/components/CatalogArtifactActions';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, {
  PublicDetailFact,
  PublicDetailFacts,
  PublicDetailSection,
} from '@/components/PublicDetailLayout';
import { pageMetadata } from '@/lib/seo';
import { personaDetailSchema } from '@/lib/structured-data';
import { loadPersonaDetail } from './personaDetail';

/**
 * ONE persona, server-rendered, indexable.
 *
 * Same two defects as the skills sibling, fixed the same way: the persona was
 * fetched in a `useEffect` (so no `generateMetadata` was possible) and `/personas`
 * was outside `PUBLIC_SHELL_PREFIXES` (so a logged-out crawler got the `/personas`
 * teaser under every slug). The persona's voice, perspective and decision style
 * are the substance a search for "AI code reviewer persona" should match, and
 * none of it was in the HTML.
 *
 * ── The OG image, plainly ────────────────────────────────────────────────────
 * No per-persona rendered social card exists and none can: `next/og` returns an
 * empty 0-byte PNG on the Cloudflare edge runtime, so link unfurls would fall
 * back to a stale cached preview — worse than the static branded card. See
 * `lib/seo.ts`. The per-entity card is therefore complete per-entity METADATA
 * plus JSON-LD over one static branded image.
 */
export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const persona = await loadPersonaDetail(decodeURIComponent(slug));
  const t = await getTranslations('personaDetail');
  if (!persona) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };

  // The blurb first; when a persona has none, its voice and perspective say more
  // about what it is than a generic sentence would.
  const description = persona.description?.slice(0, 200)
    || t('metaFallback', { name: persona.name, voice: persona.voice, perspective: persona.perspective });
  return {
    ...pageMetadata({
      title: t('metaTitle', { name: persona.name }),
      description,
      path: `/personas/${persona.slug}`,
      ogTitle: persona.name,
    }),
    ...(persona.tags.length || persona.capabilities.length
      ? { keywords: [...persona.tags, ...persona.capabilities] }
      : {}),
    ...(persona.author ? { authors: [{ name: persona.author }] } : {}),
  };
}

export default async function PersonaDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const persona = await loadPersonaDetail(decodeURIComponent(slug));
  if (!persona) notFound();
  const t = await getTranslations('personaDetail');

  return (
    <>
      <JsonLd
        data={personaDetailSchema({
          name: persona.name,
          slug: persona.slug,
          description: persona.description,
          category: persona.category,
          tags: persona.tags,
          voice: persona.voice,
          perspective: persona.perspective,
          decisionStyle: persona.decisionStyle,
          capabilities: persona.capabilities,
          authorName: persona.author,
          installCount: persona.installCount,
        })}
      />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={persona.name}
        lede={persona.description}
        tags={persona.tags}
        meta={[
          persona.author ? t('byAuthor', { author: persona.author }) : null,
          persona.category,
          persona.builtin ? t('builtinBadge') : null,
        ]}
        actions={<CatalogArtifactActions artifactType="persona" slug={persona.slug} name={persona.name} />}
      >
        <PublicDetailSection heading={t('detailsHeading')}>
          <PublicDetailFacts>
            <PublicDetailFact label={t('voiceLabel')}>{persona.voice}</PublicDetailFact>
            <PublicDetailFact label={t('perspectiveLabel')}>{persona.perspective}</PublicDetailFact>
            <PublicDetailFact label={t('decisionStyleLabel')}>{persona.decisionStyle}</PublicDetailFact>
            {persona.outputPrefix ? (
              <PublicDetailFact label={t('outputPrefixLabel')}>
                <code className="pdl-code">{persona.outputPrefix}</code>
              </PublicDetailFact>
            ) : null}
            {persona.capabilities.length ? (
              <PublicDetailFact label={t('capabilitiesLabel')}>
                {persona.capabilities.join(', ')}
              </PublicDetailFact>
            ) : null}
            {persona.tags.length ? (
              <PublicDetailFact label={t('tagsLabel')}>{persona.tags.join(', ')}</PublicDetailFact>
            ) : null}
          </PublicDetailFacts>
        </PublicDetailSection>

        <p style={{ marginTop: 28 }}>
          <Link className="pdl-back" href="/personas">{t('back')}</Link>
        </p>
      </PublicDetailLayout>
    </>
  );
}
