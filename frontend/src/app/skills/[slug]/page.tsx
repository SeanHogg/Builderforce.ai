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
import { marketplaceSkillSchema, skillCatalogSchema } from '@/lib/structured-data';
import { loadSkillDetail } from './skillDetail';

/**
 * ONE skill, server-rendered, indexable.
 *
 * This route was a Client Component that fetched its skill in a `useEffect`, so
 * `generateMetadata` was not merely missing — it was impossible, and every skill
 * URL therefore shared the site-wide default title. Worse, `/skills` was not in
 * `PUBLIC_SHELL_PREFIXES`, so a logged-out crawler never reached the page at all:
 * it got the `/skills` marketing teaser under every slug, which is one piece of
 * duplicate content wearing hundreds of URLs. Both halves are fixed here — the
 * data is read on the server, and `shellRouting` now renders `/skills/<slug>`
 * (but not the `/skills` index) publicly.
 *
 * ── The OG image, plainly ────────────────────────────────────────────────────
 * There is no per-skill rendered social card and there deliberately cannot be
 * one: a `next/og` ImageResponse route returns an EMPTY 0-byte PNG on the
 * Cloudflare edge runtime (the Satori/resvg WASM path), which makes link
 * unfurls fall back to a stale cached preview — strictly worse than the static
 * branded card. See `lib/seo.ts`. So the per-entity "OG card" is delivered as
 * complete per-entity METADATA — title, description, canonical, og:type, author,
 * tags — plus JSON-LD, over the one static branded image.
 */
export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const skill = await loadSkillDetail(decodeURIComponent(slug));
  const t = await getTranslations('skillDetail');
  if (!skill) return { title: t('notFoundTitle'), robots: { index: false, follow: false } };

  const description = skill.description?.slice(0, 200) || t('metaFallback', { name: skill.name });
  return {
    ...pageMetadata({
      title: t('metaTitle', { name: skill.name }),
      description,
      // A published skill canonicalises to its marketplace page; only a built-in
      // is canonical here. See `SkillDetailView.canonicalPath`.
      path: skill.canonicalPath,
      ogTitle: skill.name,
    }),
    ...(skill.tags.length ? { keywords: skill.tags } : {}),
    ...(skill.author ? { authors: [{ name: skill.author }] } : {}),
  };
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const skill = await loadSkillDetail(decodeURIComponent(slug));
  if (!skill) notFound();
  const t = await getTranslations('skillDetail');

  const schema = skill.builtin
    ? skillCatalogSchema({
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        category: skill.category,
        author: skill.author,
        tags: skill.tags,
        version: skill.version,
      })
    : marketplaceSkillSchema({
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        category: skill.category,
        author_display_name: skill.author,
        tags: skill.tags,
      });

  return (
    <>
      <JsonLd data={schema} />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={skill.name}
        icon={skill.emoji}
        lede={skill.description}
        tags={skill.tags}
        meta={[
          skill.author ? t('byAuthor', { author: skill.author }) : null,
          skill.category,
          skill.version ? t('versionShort', { version: skill.version }) : null,
          skill.builtin ? t('builtinBadge') : null,
        ]}
        actions={
          <>
            <CatalogArtifactActions artifactType="skill" slug={skill.slug} name={skill.name} />
            {skill.builtin ? null : (
              <Link className="pdl-btn pdl-btn-ghost" href={`/marketplace/${skill.slug}`}>
                {t('viewOnMarketplace')}
              </Link>
            )}
          </>
        }
      >
        <PublicDetailSection heading={t('detailsHeading')}>
          <PublicDetailFacts>
            <PublicDetailFact label={t('slugLabel')}>
              <code className="pdl-code">{skill.slug}</code>
            </PublicDetailFact>
            {skill.category ? (
              <PublicDetailFact label={t('categoryLabel')}>{skill.category}</PublicDetailFact>
            ) : null}
            {skill.version ? (
              <PublicDetailFact label={t('versionLabel')}>{skill.version}</PublicDetailFact>
            ) : null}
            {skill.author ? (
              <PublicDetailFact label={t('authorLabel')}>{skill.author}</PublicDetailFact>
            ) : null}
            {skill.tags.length ? (
              <PublicDetailFact label={t('tagsLabel')}>{skill.tags.join(', ')}</PublicDetailFact>
            ) : null}
          </PublicDetailFacts>
        </PublicDetailSection>

        {skill.readme ? (
          <PublicDetailSection heading={t('aboutHeading')} prose>{skill.readme}</PublicDetailSection>
        ) : null}

        <p style={{ marginTop: 28 }}>
          <Link className="pdl-back" href="/skills">{t('back')}</Link>
        </p>
      </PublicDetailLayout>
    </>
  );
}
