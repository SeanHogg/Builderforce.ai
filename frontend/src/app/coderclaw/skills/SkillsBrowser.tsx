'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface Skill {
  id: string;
  name: string;
  author: string;
  description: string;
  category?: string;
  likes?: number;
  downloads?: number;
  tags?: string[];
  image?: string;
}

type SortKey = 'trending' | 'newest' | 'popular' | 'downloads';

function score(s: Skill, sort: SortKey): number {
  if (sort === 'popular') return s.likes ?? 0;
  if (sort === 'downloads') return s.downloads ?? 0;
  // trending = likes + downloads/4 (default)
  return (s.likes ?? 0) + (s.downloads ?? 0) / 4;
}

export default function SkillsBrowser({ skills }: { skills: Skill[] }) {
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('trending');

  const categories = useMemo(
    () => Array.from(new Set(skills.map((s) => s.category).filter((c): c is string => Boolean(c)))).sort(),
    [skills]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills
      .filter((s) => !category || s.category === category)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
      .slice()
      .sort((a, b) => score(b, sort) - score(a, sort));
  }, [skills, category, search, sort]);

  return (
    <div className="cc-skills-page">
      <header className="cc-skills-hero">
        <h1 className="cc-skills-title">Agent Skills Directory</h1>
        <p className="cc-skills-lead">
          Discover and share powerful agent skills. Browse the community registry or upload your own.
        </p>
        <div className="cc-skills-cta">
          <Link href="/marketplace" className="cc-btn primary">Browse marketplace</Link>
          <Link href="/login" className="cc-btn">Share your skill</Link>
        </div>
      </header>

      <section className="cc-skills-filters">
        <div className="cc-skills-filter">
          <label htmlFor="cc-cat">Category</label>
          <select id="cc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="cc-skills-filter">
          <label htmlFor="cc-search">Search</label>
          <input
            id="cc-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
          />
        </div>
        <div className="cc-skills-filter">
          <label htmlFor="cc-sort">Sort</label>
          <select id="cc-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="trending">Trending</option>
            <option value="newest">Newest</option>
            <option value="popular">Most Popular</option>
            <option value="downloads">Most Downloaded</option>
          </select>
        </div>
      </section>

      <p className="cc-skills-count">
        Showing {visible.length} of {skills.length} skills
      </p>

      <div className="cc-skills-grid">
        {visible.map((s) => (
          <article key={s.id} className="cc-skill-card">
            <div className="cc-skill-head">
              <h3 className="cc-skill-name">{s.name}</h3>
              {s.category && <span className="cc-skill-cat">{s.category}</span>}
            </div>
            <p className="cc-skill-author">by {s.author}</p>
            <p className="cc-skill-desc">{s.description}</p>
            {s.tags && s.tags.length > 0 && (
              <div className="cc-skill-tags">
                {s.tags.map((t) => <span key={t} className="cc-skill-tag">#{t}</span>)}
              </div>
            )}
            <div className="cc-skill-stats">
              {typeof s.likes === 'number' && <span>♥ {s.likes}</span>}
              {typeof s.downloads === 'number' && <span>↓ {s.downloads}</span>}
            </div>
          </article>
        ))}
      </div>

      <style>{`
        .cc-skills-page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 56px 24px 80px;
        }
        .cc-skills-hero {
          text-align: center;
          margin-bottom: 32px;
        }
        .cc-skills-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2rem, 5vw, 3rem);
          margin: 0;
        }
        .cc-skills-lead {
          color: var(--text-secondary);
          margin-top: 12px;
        }
        .cc-skills-cta {
          margin-top: 20px;
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .cc-btn {
          padding: 10px 22px;
          border-radius: 11px;
          text-decoration: none;
          color: var(--text-primary);
          background: var(--surface-interactive, rgba(136,146,176,0.08));
          border: 1px solid var(--border-subtle);
          font-weight: 600;
          font-size: 0.9rem;
        }
        .cc-btn.primary {
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark, var(--coral-bright)));
          color: white;
          border-color: transparent;
        }
        .cc-skills-filters {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 16px;
          padding: 16px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 50%, transparent);
        }
        .cc-skills-filter {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 180px;
        }
        .cc-skills-filter label {
          font-size: 0.78rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .cc-skills-filter input,
        .cc-skills-filter select {
          padding: 8px 10px;
          border: 1px solid var(--border-subtle);
          border-radius: 9px;
          background: var(--bg-deep);
          color: var(--text-primary);
          font-family: inherit;
          font-size: 0.9rem;
        }
        .cc-skills-count {
          color: var(--text-secondary);
          font-size: 0.85rem;
          margin: 0 0 16px;
        }
        .cc-skills-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .cc-skill-card {
          padding: 18px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cc-skill-head {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 8px;
        }
        .cc-skill-name {
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 1.05rem;
          margin: 0;
        }
        .cc-skill-cat {
          font-size: 0.7rem;
          padding: 3px 8px;
          background: rgba(77,158,255,0.12);
          color: var(--coral-bright);
          border-radius: 5px;
          white-space: nowrap;
        }
        .cc-skill-author {
          color: var(--text-muted);
          font-size: 0.78rem;
          margin: 0;
        }
        .cc-skill-desc {
          color: var(--text-secondary);
          font-size: 0.88rem;
          line-height: 1.5;
          margin: 4px 0 0;
        }
        .cc-skill-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .cc-skill-tag {
          font-size: 0.72rem;
          color: var(--text-muted);
        }
        .cc-skill-stats {
          margin-top: auto;
          padding-top: 8px;
          display: flex;
          gap: 12px;
          color: var(--text-muted);
          font-size: 0.8rem;
        }
      `}</style>
    </div>
  );
}
