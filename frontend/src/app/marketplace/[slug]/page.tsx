import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { marketplaceSkillSchema } from '@/lib/structured-data';
import { getPublishedSkill } from '@/lib/marketplaceSeo';
import { FOOTER_LINKS } from '@/lib/content';

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

  return (
    <>
      <JsonLd data={marketplaceSkillSchema(skill)} />

      <style>{`
        .mps { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
        .mps-main { max-width: 820px; margin: 0 auto; padding: 44px 24px 24px; width: 100%; }
        .mps-eyebrow { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--coral-bright); margin-bottom: 12px; }
        .mps-title { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; font-size: clamp(1.9rem, 5vw, 2.8rem); color: var(--text-primary); margin: 0 0 12px; }
        .mps-meta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 18px; }
        .mps-desc { font-size: clamp(0.98rem, 2vw, 1.1rem); color: var(--text-primary); line-height: 1.7; margin: 0 0 18px; }
        .mps-tags { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 22px; }
        .mps-tag { font-size: 0.74rem; font-weight: 600; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 999px; padding: 4px 12px; }
        .mps-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 4px 0 28px; }
        .mps-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 12px; font-weight: 600; font-size: 0.95rem; text-decoration: none; }
        .mps-btn-primary { background: linear-gradient(135deg, var(--coral-bright), #e23b2e); color: #fff; }
        .mps-btn-ghost { background: var(--surface-card); border: 1px solid var(--border-subtle); color: var(--text-primary); }
        .mps-readme { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 22px 24px; color: var(--text-primary); line-height: 1.7; white-space: pre-wrap; font-size: 0.92rem; }
        .mps-h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.1rem; color: var(--text-primary); margin: 0 0 12px; }
        .mps-footer { border-top: 1px solid var(--border-subtle); margin-top: 28px; padding: 24px; display: flex; gap: 16px 22px; flex-wrap: wrap; justify-content: center; }
        .mps-footer a { color: var(--text-secondary); text-decoration: none; font-size: 0.85rem; }
        .mps-footer a:hover { color: var(--text-primary); }
      `}</style>

      <main className="mps">
        <div className="mps-main">
          <div className="mps-eyebrow">Workforce Registry · Skill</div>
          <h1 className="mps-title">{skill.name}</h1>
          <div className="mps-meta">
            {author ? <span>by {author}</span> : null}
            {skill.category ? <span>· {skill.category}</span> : null}
            {skill.version ? <span>· v{skill.version}</span> : null}
            {typeof skill.downloads === 'number' ? <span>· {skill.downloads} downloads</span> : null}
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
              Get this skill
            </Link>
            <Link className="mps-btn mps-btn-ghost" href="/marketplace">Browse the registry</Link>
          </div>

          {skill.readme ? (
            <>
              <h2 className="mps-h2">About this skill</h2>
              <div className="mps-readme">{skill.readme}</div>
            </>
          ) : null}
        </div>

        <footer className="mps-footer">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
        </footer>
      </main>
    </>
  );
}
