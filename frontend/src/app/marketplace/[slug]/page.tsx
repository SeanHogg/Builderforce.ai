import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { marketplaceSkillSchema } from '@/lib/structured-data';
import { getPublishedSkill } from '@/lib/marketplaceSeo';

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
  return pageMetadata({
    title: `${skill.name} — Workforce Registry Skill | Builderforce.ai`,
    description: desc,
    path: `/marketplace/${skill.slug}`,
    ogTitle: skill.name,
  });
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

      <style>{`
        .mps { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        /* THE marketing column (globals.css) — same measure as the header. */
        .mps-main { max-width: var(--marketing-max); margin: 0 auto; padding: 44px var(--marketing-gutter) 24px; width: 100%; }
        .mps-eyebrow { font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 12px; }
        .mps-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; font-size: var(--font-size-page-title); color: var(--text-primary); margin: 0 0 12px; }
        .mps-meta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; color: var(--text-secondary); font-size: var(--font-size-small); margin: 0 0 18px; }
        .mps-desc { font-size: var(--font-size-lede); color: var(--text-primary); line-height: 1.7; margin: 0 0 18px; }
        .mps-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 22px; }
        .mps-tag { font-size: var(--font-size-eyebrow); font-weight: 600; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 4px 12px; }
        .mps-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 4px 0 28px; }
        .mps-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: var(--radius-lg); font-weight: 600; font-size: var(--font-size-body); text-decoration: none; }
        .mps-btn-primary { background: linear-gradient(135deg, var(--coral-bright), var(--error)); color: var(--text-on-accent); }
        .mps-btn-ghost { background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-primary); }
        .mps-readme { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 22px 24px; color: var(--text-primary); line-height: 1.7; white-space: pre-wrap; font-size: var(--font-size-body); }
        .mps-h2 { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-card-title); color: var(--text-primary); margin: 0 0 12px; }
      `}</style>

      <main className="mps">
        <div className="mps-main">
          <div className="mps-eyebrow">{t('eyebrow')}</div>
          <h1 className="mps-title">{skill.name}</h1>
          <div className="mps-meta">
            {author ? <span>{t('byAuthor', { author })}</span> : null}
            {skill.category ? <span>· {skill.category}</span> : null}
            {skill.version ? <span>· v{skill.version}</span> : null}
            {typeof skill.downloads === 'number' ? <span>· {t('downloads', { count: skill.downloads })}</span> : null}
          </div>

          {skill.description ? <p className="mps-desc">{skill.description}</p> : null}

          {skill.tags.length ? (
            <div className="mps-tags">
              {skill.tags.map((t) => (
                <span className="mps-tag" key={t}>{t}</span>
              ))}
            </div>
          ) : null}

          <div className="mps-cta-row">
            <Link className="mps-btn mps-btn-primary" href={`/marketplace?skill=${encodeURIComponent(skill.slug)}`}>
              {t('getCta')}
            </Link>
            <Link className="mps-btn mps-btn-ghost" href="/marketplace">{t('browseCta')}</Link>
          </div>

          {skill.readme ? (
            <>
              <h2 className="mps-h2">{t('aboutHeading')}</h2>
              <div className="mps-readme">{skill.readme}</div>
            </>
          ) : null}
        </div>

        {/* Footer is the canonical <AppFooter variant="full"> rendered by PublicShell. */}
      </main>
    </>
  );
}
