'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  claws,
  artifactAssignments,
  marketplaceStats,
  listMarketplaceSkills,
  marketplacePublisherApi,
  getMarketplaceToken,
  setMarketplaceToken,
  type ArtifactStats,
  type MarketplaceUser,
} from '@/lib/builderforceApi';
import {
  BUILTIN_PERSONAS,
  BUILTIN_SKILLS,
  userSkillsKey,
  contentStorageKey,
  type Persona,
  type BuiltinSkill,
} from '@/lib/marketplaceData';
import { listAgents, hireAgent } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import ArtifactAssigner from '@/components/ArtifactAssigner';

type MarketplaceCategory = 'all' | 'personas' | 'skills' | 'content' | 'workforce' | 'publish';

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
  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [hiringId, setHiringId] = useState<string | null>(null);

  // Publisher auth state
  const [mpUser, setMpUser] = useState<MarketplaceUser | null>(null);
  const [mpAuthMode, setMpAuthMode] = useState<'login' | 'register'>('login');
  const [mpEmail, setMpEmail] = useState('');
  const [mpPassword, setMpPassword] = useState('');
  const [mpUsername, setMpUsername] = useState('');
  const [mpAuthError, setMpAuthError] = useState<string | null>(null);
  const [mpAuthLoading, setMpAuthLoading] = useState(false);
  // Publish skill form
  const [skillForm, setSkillForm] = useState({ name: '', slug: '', description: '', category: '', version: '1.0.0', repoUrl: '' });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Check for persisted marketplace token on mount
  useEffect(() => {
    const token = getMarketplaceToken();
    if (!token) return;
    marketplacePublisherApi.me().then(({ user }) => setMpUser(user)).catch(() => setMarketplaceToken(null));
  }, []);

  const handleMpAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMpAuthLoading(true);
    setMpAuthError(null);
    try {
      const result = mpAuthMode === 'register'
        ? await marketplacePublisherApi.register({ email: mpEmail, password: mpPassword, username: mpUsername || undefined })
        : await marketplacePublisherApi.login({ email: mpEmail, password: mpPassword });
      setMarketplaceToken(result.token);
      setMpUser(result.user);
    } catch (e) {
      setMpAuthError(e instanceof Error ? e.message : 'Auth failed');
    } finally {
      setMpAuthLoading(false);
    }
  };

  const handlePublishSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillForm.name.trim() || !skillForm.slug.trim()) return;
    setPublishing(true);
    setPublishError(null);
    setPublishSuccess(false);
    try {
      await marketplacePublisherApi.publishSkill({
        name: skillForm.name.trim(),
        slug: skillForm.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        description: skillForm.description.trim() || undefined,
        category: skillForm.category.trim() || undefined,
        version: skillForm.version.trim() || '1.0.0',
        repoUrl: skillForm.repoUrl.trim() || undefined,
      });
      setPublishSuccess(true);
      setSkillForm({ name: '', slug: '', description: '', category: '', version: '1.0.0', repoUrl: '' });
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

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

  useEffect(() => {
    setLoadingAgents(true);
    listAgents()
      .then((list) => setAgents(list.filter((a) => a.status === 'active')))
      .catch(() => setAgents([]))
      .finally(() => setLoadingAgents(false));
  }, []);

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

  const filteredAgents = agents.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.title && a.title.toLowerCase().includes(q)) ||
      (a.bio && a.bio.toLowerCase().includes(q)) ||
      (a.skills && a.skills.some((s) => s.toLowerCase().includes(q)))
  );

  const handleHire = useCallback(async (agentId: string) => {
    setHiringId(agentId);
    try {
      const updated = await hireAgent(agentId);
      setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)));
    } catch {
      // keep UI stable
    } finally {
      setHiringId(null);
    }
  }, []);

  const categories: { id: MarketplaceCategory; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'personas', label: 'Personas' },
    { id: 'skills', label: 'Skills' },
    { id: 'content', label: 'Content' },
    { id: 'workforce', label: 'Workforce Agents' },
    { id: 'publish', label: mpUser ? `Publish (${mpUser.username})` : 'Publish' },
  ];

  const loadingPage = category !== 'publish' && (loading || (category === 'workforce' && loadingAgents));
  if (loadingPage) {
    return (
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          {category === 'workforce' ? 'Loading workforce agents…' : 'Loading marketplace…'}
        </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }} role="group" aria-label="Filter by type">
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Category</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={category === c.id ? 'btn btn-primary' : 'btn btn-secondary'}
                aria-pressed={category === c.id}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {category === 'publish' ? (
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          {!mpUser ? (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Publisher Account</div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                Create a free publisher account to share skills with the community. This is separate from your workspace login.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mpAuthMode === m ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => { setMpAuthMode(m); setMpAuthError(null); }}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {m === 'login' ? 'Sign In' : 'Register'}
                  </button>
                ))}
              </div>
              <form onSubmit={handleMpAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mpAuthMode === 'register' && (
                  <input
                    type="text"
                    placeholder="Username (optional)"
                    value={mpUsername}
                    onChange={(e) => setMpUsername(e.target.value)}
                    style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)' }}
                  />
                )}
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={mpEmail}
                  onChange={(e) => setMpEmail(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)' }}
                />
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={mpPassword}
                  onChange={(e) => setMpPassword(e.target.value)}
                  style={{ padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)' }}
                />
                {mpAuthError && <div style={{ fontSize: 12, color: 'var(--error-text)' }}>{mpAuthError}</div>}
                <button type="submit" disabled={mpAuthLoading} className="btn btn-primary">
                  {mpAuthLoading ? '…' : mpAuthMode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </form>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Signed in as <strong>{mpUser.username}</strong></div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{mpUser.email}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setMarketplaceToken(null); setMpUser(null); }}
                >
                  Sign out
                </button>
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Publish a Skill</div>
                {publishSuccess && (
                  <div style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13, color: 'var(--success, #22c55e)', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
                    Skill published! It will appear in the marketplace after review.
                  </div>
                )}
                <form onSubmit={handlePublishSkill} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Name *</label>
                      <input required type="text" placeholder="My Skill" value={skillForm.name}
                        onChange={(e) => setSkillForm((f) => ({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Slug * (unique ID)</label>
                      <input required type="text" placeholder="my-skill" value={skillForm.slug}
                        onChange={(e) => setSkillForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Description</label>
                    <textarea rows={3} placeholder="What does this skill do?" value={skillForm.description}
                      onChange={(e) => setSkillForm((f) => ({ ...f, description: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Category</label>
                      <input type="text" placeholder="coding" value={skillForm.category}
                        onChange={(e) => setSkillForm((f) => ({ ...f, category: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Version</label>
                      <input type="text" value={skillForm.version}
                        onChange={(e) => setSkillForm((f) => ({ ...f, version: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Repo URL</label>
                      <input type="url" placeholder="https://github.com/…" value={skillForm.repoUrl}
                        onChange={(e) => setSkillForm((f) => ({ ...f, repoUrl: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  {publishError && <div style={{ fontSize: 12, color: 'var(--error-text)' }}>{publishError}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" disabled={publishing || !skillForm.name.trim() || !skillForm.slug.trim()} className="btn btn-primary">
                      {publishing ? 'Publishing…' : 'Publish Skill'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : category === 'workforce' ? (
        filteredAgents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
            {agents.length === 0
              ? 'No published workforce agents yet. Publish an agent from a project to list it here.'
              : 'No workforce agents match your search.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filteredAgents.map((agent) => (
              <div key={agent.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24 }}>👤</span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>{agent.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{agent.title || 'Workforce agent'}</div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 99,
                      background: 'var(--accent)',
                      color: '#fff',
                      textTransform: 'uppercase',
                    }}
                  >
                    Agent
                  </span>
                </div>
                {agent.bio && (
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>{agent.bio}</div>
                )}
                {agent.skills && agent.skills.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {agent.skills.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 99,
                          background: 'var(--surface-2)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {s}
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
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {agent.hire_count != null ? `Hired ${agent.hire_count}×` : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={hiringId === agent.id}
                    onClick={() => handleHire(agent.id)}
                  >
                    {hiringId === agent.id ? 'Hiring…' : 'Hire'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
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
                        color: stat.liked ? 'var(--error)' : 'var(--muted)',
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
