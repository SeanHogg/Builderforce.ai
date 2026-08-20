import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import PublicDetailLayout, { PublicDetailSection } from '@/components/PublicDetailLayout';
import { pageMetadata } from '@/lib/seo';
import { marketplaceSkillSchema } from '@/lib/structured-data';
import { getPublishedSkill } from '@/lib/marketplaceSeo';

/**
 * One published marketplace skill.
 *
 * This page carried its own `.mps-*` stylesheet — the first copy of the shape
 * every public entity page needs. It now renders through `PublicDetailLayout`,
 * which is that shape written once; the visual result is unchanged and four new
 * detail pages share it rather than forking it.
 */
export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const skill = await getPublishedSkill(slug);
  if (!skill) return { title: 'Skill Not Found', robots: { index: false, follow: false } };
  const desc = skill.description?.slice(0, 200) || `${skill.name} — a published skill on the Builderforce.ai Workforce Registry.`;
  const author = skill.author_display_name || skill.author_username;
  return {
    ...pageMetadata({
      title: `${skill.name} — Workforce Registry Skill | Builderforce.ai`,
      description: desc,
      path: `/marketplace/${skill.slug}`,
      ogTitle: skill.name,
    }),
    // Per-entity social/discovery fields, over the one static branded OG image:
    // a rendered per-skill card is not available on the Cloudflare edge runtime
    // (see `lib/seo.ts`), so the card's substance ships as metadata instead.
    ...(skill.tags.length ? { keywords: skill.tags } : {}),
    ...(author ? { authors: [{ name: author }] } : {}),
  };
}

export default async function MarketplaceSkillPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const skill = await getPublishedSkill(slug);
  if (!skill) notFound();
  const author = skill.author_display_name || skill.author_username;
  const t = await getTranslations('marketplaceSkill');

  return (
    <>
      <JsonLd data={marketplaceSkillSchema(skill)} />
      <PublicDetailLayout
        eyebrow={t('eyebrow')}
        title={skill.name}
        lede={skill.description}
        tags={skill.tags}
        meta={[
          author ? t('byAuthor', { author }) : null,
          skill.category,
          skill.version ? `v${skill.version}` : null,
          typeof skill.downloads === 'number' ? t('downloads', { count: skill.downloads }) : null,
        ]}
        actions={
          <>
            <Link className="pdl-btn pdl-btn-primary" href={`/marketplace?skill=${encodeURIComponent(skill.slug)}`}>
              {t('getCta')}
            </Link>
            <Link className="pdl-btn pdl-btn-ghost" href="/marketplace">{t('browseCta')}</Link>
          </>
        }
      >
        {skill.readme ? (
          <PublicDetailSection heading={t('aboutHeading')} prose>{skill.readme}</PublicDetailSection>
        ) : null}
      </PublicDetailLayout>
    </>
  );
}
