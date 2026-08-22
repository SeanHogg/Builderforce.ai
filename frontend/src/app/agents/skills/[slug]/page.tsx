import { Icon } from '@/components/ui/Icon';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { pageMetadata } from '@/lib/seo';
import { getSkillBySlug } from '../skillsData';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('agents.skillDetail');
  const skill = await getSkillBySlug(slug);
  if (!skill) {
    return { title: t('notFoundTitle') };
  }
  return pageMetadata({
    title: t('metaTitle', { name: skill.name }),
    description: skill.description,
    path: `/agents/skills/${slug}`,
  });
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('agents.skillDetail');
  const skill = await getSkillBySlug(slug);

  if (!skill) {
    // No matching skill — render a 404 rather than an empty shell.
    notFound();
  }

  return (
    <div className="cc-skill-detail">
      <nav className="cc-skill-crumbs">
        <Link href="/agents/skills">{t('crumb')}</Link>
        <span aria-hidden="true">/</span>
        <span>{skill.name}</span>
      </nav>

      <header className="cc-skill-detail-head">
        <div>
          <h1 className="cc-skill-detail-title">{skill.name}</h1>
          <p className="cc-skill-detail-author">{t('byAuthor', { author: skill.author })}</p>
        </div>
        {skill.category && <span className="cc-skill-detail-cat">{skill.category}</span>}
      </header>

      <p className="cc-skill-detail-desc">{skill.description}</p>

      {skill.tags && skill.tags.length > 0 && (
        <div className="cc-skill-detail-tags">
          {skill.tags.map((tag) => (
            <span key={tag} className="cc-skill-detail-tag">#{tag}</span>
          ))}
        </div>
      )}

      <div className="cc-skill-detail-stats">
        {typeof skill.likes === 'number' && <span><Icon source="♥" size="1em" /> {t('likes', { count: skill.likes })}</span>}
        {typeof skill.downloads === 'number' && <span>↓ {t('downloads', { count: skill.downloads })}</span>}
      </div>

      <section className="cc-skill-detail-install">
        <h2>{t('installHeading')}</h2>
        <p>{t.rich('installBody', { name: () => <strong>{skill.name}</strong> })}</p>
        <pre><code>builderforce skills add {skill.id}</code></pre>
      </section>

      <div className="cc-skill-detail-cta">
        <Link href="/marketplace" className="cc-btn primary">{t('getOnMarketplace')}</Link>
        <Link href="/agents/skills" className="cc-btn">{t('browseAll')}</Link>
      </div>

      <style>{`
        .cc-skill-detail {
          max-width: 760px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-skill-crumbs {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: var(--font-size-small);
          color: var(--text-muted);
          margin-bottom: 24px;
        }
        .cc-skill-crumbs a {
          color: var(--coral-bright);
          text-decoration: none;
        }
        .cc-skill-crumbs a:hover { text-decoration: underline; }
        .cc-skill-detail-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .cc-skill-detail-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: var(--font-size-page-title);
          margin: 0;
          color: var(--text-primary);
        }
        .cc-skill-detail-author {
          color: var(--text-muted);
          font-size: var(--font-size-body);
          margin: 6px 0 0;
        }
        .cc-skill-detail-cat {
          font-size: var(--font-size-small);
          padding: 4px 10px;
          background: color-mix(in srgb, var(--coral-bright) 12%, transparent);
          color: var(--coral-bright);
          border-radius: var(--radius-sm);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .cc-skill-detail-desc {
          color: var(--text-secondary);
          font-size: var(--font-size-card-title);
          line-height: 1.7;
          margin: 24px 0 16px;
        }
        .cc-skill-detail-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 16px;
        }
        .cc-skill-detail-tag {
          font-size: var(--font-size-small);
          color: var(--text-muted);
        }
        .cc-skill-detail-stats {
          display: flex;
          gap: 18px;
          color: var(--text-muted);
          font-size: var(--font-size-small);
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .cc-skill-detail-install {
          margin: 28px 0;
        }
        .cc-skill-detail-install h2 {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: var(--font-size-card-title);
          color: var(--text-primary);
          margin: 0 0 10px;
        }
        .cc-skill-detail-install p {
          color: var(--text-secondary);
          line-height: 1.7;
          margin: 0 0 14px;
        }
        .cc-skill-detail-install pre {
          padding: 16px 18px;
          background: var(--bg-elevated, rgba(0,0,0,0.35));
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          overflow-x: auto;
        }
        .cc-skill-detail-install code {
          font-family: var(--font-mono);
          font-size: var(--font-size-body);
          color: var(--cyan-bright);
        }
        .cc-skill-detail-cta {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 28px;
        }
        .cc-btn {
          padding: 10px 22px;
          border-radius: var(--radius-lg);
          text-decoration: none;
          color: var(--text-primary);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          border: 1px solid var(--border-subtle);
          font-weight: 600;
          font-size: var(--font-size-body);
        }
        .cc-btn.primary {
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark, var(--coral-bright)));
          color: var(--text-on-accent);
          border-color: transparent;
        }
      `}</style>
    </div>
  );
}
