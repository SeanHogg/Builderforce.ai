'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  claws,
  artifactAssignments,
  marketplaceStats,
  listMarketplaceSkills,
  type ArtifactStats,
} from '@/lib/builderforceApi';
import {
  BUILTIN_PERSONAS,
  BUILTIN_SKILLS,
  userSkillsKey,
  contentStorageKey,
  type Persona,
  type BuiltinSkill,
} from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

type MarketplaceCategory = 'all' | 'personas' | 'skills' | 'content';

interface ContentBlock {
  id: string;
  title: string;
  type: string;
  status: string;
  body: string;
  tags: string[];
  sharedToMarketplace?: boolean;
  image?: string;
  likes?: number;
  downloads?: number;
}

interface UserSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  tags?: string[];
  version: string;
  shared: boolean;
}

interface MarketplaceListing {
  id: string;
  type: 'persona' | 'skill' | 'content';
  artifactSlug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string[];
  downloads: number;
  likes: number;
  image?: string;
  emoji?: string;
}

function loadSharedSkills(tenantId: string): MarketplaceListing[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(userSkillsKey(tenantId));
    if (!raw) return [];
    const skills = JSON.parse(raw) as UserSkill[];
    return skills
      .filter((s) => s.shared)
      .map((s) => ({
        id: `skill:${s.id}`,
        type: 'skill' as const,
        artifactSlug: s.slug || s.id,
        name: s.name,
        description: s.description || '',
        author: 'You',
        version: s.version || '1.0.0',
        tags: (s.tags?.length ? s.tags : s.category ? [s.category] : []),
        downloads: 0,
        likes: 0,
      }));
  } catch {
    return [];
  }
}

function loadSharedContent(tenantId: string): MarketplaceListing[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(contentStorageKey(tenantId));
    if (!raw) return [];
    const blocks = JSON.parse(raw) as ContentBlock[];
    return blocks
      .filter((b) => b.sharedToMarketplace && b.status === 'published')
      .map((b) => ({
        id: `content:${b.id}`,
        type: 'content' as const,
        artifactSlug: b.id,
        name: b.title,
        description: b.body.slice(0, 200),
        author: 'You',
        version: '1.0.0',
        tags: b.tags ?? [],
        downloads: b.downloads ?? 0,
        likes: b.likes ?? 0,
        image: b.image,
      }));
  } catch {
    return [];
  }
}

function personaToListing(p: Persona): MarketplaceListing {
  return {
    id: `persona:${p.name}`,
    type: 'persona',
    artifactSlug: p.name,
    name: p.name,
    description: p.description,
    author: p.author ?? 'Builderforce',
    version: '1.0.0',
    tags: p.tags ?? [],
    downloads: p.downloads ?? 0,
    likes: p.likes ?? 0,
    image: p.image,
  };
}

function builtinSkillToListing(b: BuiltinSkill): MarketplaceListing {
  return {
    id: `builtin-skill:${b.slug}`,
    type: 'skill',
    artifactSlug: b.slug,
    name: b.name,
    description: b.description,
    author: b.author ?? 'Builderforce',
    version: b.version ?? '1.0.0',
    tags: b.tags ?? [],
    downloads: b.downloads ?? 0,
    likes: b.likes ?? 0,
    image: b.image,
    emoji: b.emoji,
  };
}

export default function MarketplacePage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<MarketplaceCategory>('all');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [hasClaws, setHasClaws] = useState(true);
  const [loading, setLoading] = useState(true);

  const key = (type: MarketplaceListing['type'], slug: string) => `${type}:${slug}`;

  const refreshListings = useCallback(async () => {
    const tenantNum = Number(tenantId);
    const personaListings = BUILTIN_PERSONAS.map(personaToListing);
    const builtinSkillListings = BUILTIN_SKILLS.map(builtinSkillToListing);
    let apiSkills: MarketplaceListing[] = [];
    try {
      const res = await listMarketplaceSkills({ limit: 100 });
      apiSkills = (res.skills ?? []).map((s) => ({
        id: `api-skill:${s.slug}`,
        type: 'skill' as const,
        artifactSlug: s.slug,
        name: s.name,
        description: s.description ?? '',
        author: s.author_username ?? s.author_display_name ?? 'Marketplace',
        version: s.version ?? '1.0.0',
        tags: Array.isArray(s.tags) ? s.tags : [],
        downloads: s.downloads ?? 0,
        likes: s.likes ?? 0,
        image: s.icon_url ?? undefined,
      }));
    } catch {
      // ignore
    }
    const sharedSkills = loadSharedSkills(tenantId);
    const sharedContent = loadSharedContent(tenantId);
    const allListings = [
      ...personaListings,
      ...builtinSkillListings,
      ...apiSkills,
      ...sharedSkills,
      ...sharedContent,
    ];
    setListings(allListings);

    const [clawList, assignList] = await Promise.all([
      claws.list().catch(() => []),
      tenantNum ? artifactAssignments.list('tenant', tenantNum).catch(() => []) : [],
    ]);
    setHasClaws(clawList.length > 0);
    setInstalled(new Set(assignList.map((a) => key(a.artifactType, a.artifactSlug))));

    const byType: Record<'skill' | 'persona' | 'content', string[]> = { skill: [], persona: [], content: [] };
    for (const item of allListings) byType[item.type].push(item.artifactSlug);

    const [skillStats, personaStats, contentStats] = await Promise.all([
      byType.skill.length ? marketplaceStats.getStats('skill', byType.skill) : Promise.resolve({} as Record<string, ArtifactStats>),
      byType.persona.length ? marketplaceStats.getStats('persona', byType.persona) : Promise.resolve({} as Record<string, ArtifactStats>),
      byType.content.length ? marketplaceStats.getStats('content', byType.content) : Promise.resolve({} as Record<string, ArtifactStats>),
    ]);
    const merged: Record<string, ArtifactStats> = {};
    for (const slug of Object.keys(skillStats)) merged[key('skill', slug)] = skillStats[slug]!;
    for (const slug of Object.keys(personaStats)) merged[key('persona', slug)] = personaStats[slug]!;
    for (const slug of Object.keys(contentStats)) merged[key('content', slug)] = contentStats[slug]!;
    setStats(merged);
  }, [tenantId]);

  useEffect(() => {
    refreshListings().finally(() => setLoading(false));
  }, [refreshListings]);

  const toggleLike = async (item: MarketplaceListing) => {
    const k = key(item.type, item.artifactSlug);
    const prev = stats[k] ?? { likes: 0, installs: 0, liked: false };
    try {
      const liked = await marketplaceStats.toggleLike(item.type, item.artifactSlug);
      setStats((s) => ({
        ...s,
        [k]: {
          ...prev,
          liked,
          likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1),
        },
      }));
    } catch {
      // keep UI stable
    }
  };

  const toggleInstall = async (item: MarketplaceListing) => {
    const k = key(item.type, item.artifactSlug);
    const tenantNum = Number(tenantId);
    if (!tenantNum) return;
    const wasInstalled = installed.has(k);
    try {
      if (wasInstalled) {
        await artifactAssignments.unassign(item.type, item.artifactSlug, 'tenant', tenantNum);
      } else {
        await artifactAssignments.assign(item.type, item.artifactSlug, 'tenant', tenantNum);
      }
      setInstalled((prev) => {
        const next = new Set(prev);
        if (wasInstalled) next.delete(k);
        else next.add(k);
        return next;
      });
      const prev = stats[k] ?? { likes: 0, installs: 0, liked: false };
      setStats((s) => ({
        ...s,
        [k]: { ...prev, installs: wasInstalled ? Math.max(0, prev.installs - 1) : prev.installs + 1 },
      }));
    } catch {
      // keep UI stable
    }
  };

  let filtered = listings;
  if (category === 'personas') filtered = filtered.filter((l) => l.type === 'persona');
  if (category === 'skills') filtered = filtered.filter((l) => l.type === 'skill');
  if (category === 'content') filtered = filtered.filter((l) => l.type === 'content');
  const q = search.toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.tags.some((t) => t.includes(q))
    );
  }

  const categories: { id: MarketplaceCategory; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'personas', label: 'Personas' },
    { id: 'skills', label: 'Skills' },
    { id: 'content', label: 'Content' },
  ];

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading marketplace…</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 800, color: 'var(--text-strong)', margin: '0 0 8px' }}>
          Marketplace
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
          Browse and install personas, skills, and content to supercharge your workforce.
        </p>
      </div>

      <div
        style={{
          position: 'sticky',
          top: -16,
          zIndex: 15,
          background: 'color-mix(in srgb, var(--bg) 68%, transparent)',
          backdropFilter: 'blur(6px)',
          padding: '12px 0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <input
          type="search"
          placeholder="Search marketplace..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            maxWidth: 360,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            fontSize: 13,
          }}
          aria-label="Search marketplace"
        />
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} role="group" aria-label="Filter by type">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={category === c.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              aria-pressed={category === c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
          No items match your search.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map((item) => {
            const typeColor =
              item.type === 'persona' ? 'var(--accent,#6366f1)' : item.type === 'content' ? '#f59e0b' : '#22c55e';
            const typeIcon = item.emoji ?? (item.type === 'persona' ? '🎭' : item.type === 'content' ? '📝' : '⚡');
            const k = key(item.type, item.artifactSlug);
            const stat = stats[k] ?? { likes: item.likes, installs: item.downloads, liked: false };
            const isInstalled = installed.has(k);
            return (
              <div key={item.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
                {item.image && (
                  <div
                    style={{
                      height: 120,
                      background: `url('${item.image}') center/cover`,
                      borderBottom: '1px solid var(--border)',
                      margin: '-16px -16px 0',
                      width: 'calc(100% + 32px)',
                    }}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24 }}>{typeIcon}</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>by {item.author} · v{item.version}</div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 99,
                      background: typeColor,
                      color: '#fff',
                      textTransform: 'uppercase',
                    }}
                  >
                    {item.type}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>{item.description}</div>

                {item.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {item.tags.slice(0, 5).map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 99,
                          background: 'var(--surface-2)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 11,
                        color: stat.liked ? '#ef4444' : 'var(--muted)',
                      }}
                      title={stat.liked ? 'Unlike' : 'Like'}
                      onClick={() => toggleLike(item)}
                    >
                      {stat.liked ? '❤️' : '🤍'} {stat.likes}
                    </button>
                    <span title="Installs">⬇️ {stat.installs}</span>
                    {isInstalled && <span>✓ Installed</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <ArtifactAssigner
                      artifactType={item.type}
                      artifactSlug={item.artifactSlug}
                      artifactName={item.name}
                    />
                    <button
                      type="button"
                      className={`btn btn-sm ${isInstalled ? 'btn-secondary' : 'btn-primary'}`}
                      disabled={!hasClaws}
                      onClick={() => toggleInstall(item)}
                    >
                      {!hasClaws ? 'Register claw' : isInstalled ? 'Uninstall' : 'Install'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
