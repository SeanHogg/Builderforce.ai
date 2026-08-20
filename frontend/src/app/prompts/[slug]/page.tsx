import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, {
  PublicDetailFact,
  PublicDetailFacts,
  PublicDetailSection,
} from '@/components/PublicDetailLayout';
import { getPublicPrompt } from '@/lib/marketplaceSeo';
import { pageMetadata } from '@/lib/seo';
import { promptDetailSchema } from '@/lib/structured-data';
import PromptUseActions from './PromptUseActions';

/**
 * ONE public prompt, server-rendered, indexable.
 *
 * `/prompts` had NO detail route at all: the library opened each prompt in a
 * client-side panel, so every prompt in the catalog was invisible to search and
 * unlinkable to anyone — there was no URL to send. Prompts are also the entity
 * here with the most obvious search demand ("prompt for a code review", "SQL
 * migration prompt"), and the thing a searcher wants is the prompt TEXT, which
 * is why the body is rendered into the HTML and carried in the JSON-LD `text`.
 *
 * ── The OG image, plainly ────────────────────────────────────────────────────
 * No per-prompt rendered social card exists and none can: on the Cloudflare edge
 * runtime `next/og` returns an empty 0-byte PNG (the Satori/resvg WASM path), so
 * a generated card would make unfurls fall back to a stale cached preview —
 * worse than the static branded one. See `lib/seo.ts`. The per-entity card is
 * complete per-entity METADATA plus JSON-LD over one static branded image.
 */
export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const prompt = await getPublicPrompt(decodeURIComponent(slug));
  const t = await getTranslations('promptDetail');
  if (!prompt) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };

  // The author's description first; failing that the opening of the prompt
  // itself, which is what the page is actually about.
  const description = (prompt.description || prompt.body).slice(0, 200)
    || t('metaFallback', { title: prompt.title });
  return {
    ...pageMetadata({
      title: t('metaTitle', { title: prompt.title }),
      description,
      path: `/prompts/${prompt.slug}`,
      type: 'article',
      ogTitle: prompt.title,
    }),
    ...(prompt.tags.length ? { keywords: prompt.tags } : {}),
    ...(prompt.authorName ? { authors: [{ name: prompt.authorName }] } : {}),
  };
}

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const prompt = await getPublicPrompt(decodeURIComponent(slug));
  if (!prompt) notFound();
  const t = await getTranslations('promptDetail');

  return (
    <>
      <JsonLd data={promptDetailSchema(prompt)} />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={prompt.title}
        lede={prompt.description}
        tags={prompt.tags}
        meta={[
          prompt.authorName ? t('byAuthor', { author: prompt.authorName }) : null,
          prompt.category,
          prompt.currentVersion ? t('versionShort', { version: prompt.currentVersion }) : null,
          typeof prompt.starCount === 'number' ? t('stars', { count: prompt.starCount }) : null,
        ]}
        actions={<PromptUseActions slug={prompt.slug} initialUsageCount={prompt.usageCount} />}
      >
        {prompt.body ? (
          <PublicDetailSection heading={t('promptHeading')} prose>{prompt.body}</PublicDetailSection>
        ) : null}

        {prompt.variables.length ? (
          <PublicDetailSection heading={t('variablesHeading')}>
            <PublicDetailFacts>
              {prompt.variables.map((variable) => (
                <PublicDetailFact key={variable.name} label={variable.name}>
                  {variable.description || t('noVariableDescription')}
                  {variable.default ? (
                    <> · <code className="pdl-code">{t('variableDefault', { value: variable.default })}</code></>
                  ) : null}
                </PublicDetailFact>
              ))}
            </PublicDetailFacts>
          </PublicDetailSection>
        ) : null}

        <PublicDetailSection heading={t('detailsHeading')}>
          <PublicDetailFacts>
            {prompt.model ? (
              <PublicDetailFact label={t('modelLabel')}>{prompt.model}</PublicDetailFact>
            ) : null}
            {prompt.category ? (
              <PublicDetailFact label={t('categoryLabel')}>{prompt.category}</PublicDetailFact>
            ) : null}
            {prompt.authorName ? (
              <PublicDetailFact label={t('authorLabel')}>{prompt.authorName}</PublicDetailFact>
            ) : null}
            {prompt.tags.length ? (
              <PublicDetailFact label={t('tagsLabel')}>{prompt.tags.join(', ')}</PublicDetailFact>
            ) : null}
          </PublicDetailFacts>
        </PublicDetailSection>

        <p style={{ marginTop: 28 }}>
          <Link className="pdl-back" href="/prompts">{t('back')}</Link>
        </p>
      </PublicDetailLayout>
    </>
  );
}
