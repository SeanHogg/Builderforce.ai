'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import {
  artifactAssignments,
  marketplaceStats,
  claws,
  listMarketplaceSkills,
  type ArtifactStats,
} from '@/lib/builderforceApi';
import { BUILTIN_SKILLS, userSkillsKey, type BuiltinSkill, type UserSkill } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';
import { SkillAssignmentsContent } from '@/components/SkillAssignmentsContent';

function loadUserSkills(tenantId: string): UserSkill[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(userSkillsKey(tenantId)) ?? '[]');
  } catch {
    return [];
  }
}

function saveUserSkills(tenantId: string, skills: UserSkill[]) {
  localStorage.setItem(userSkillsKey(tenantId), JSON.stringify(skills));
}

type SkillItem = { slug: string; name: string; description: string; category?: string; icon?: string; emoji?: string; author?: string };

export default function SkillsPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [tab, setTab] = useState<'assigned' | 'marketplace' | 'my-skills'>('assigned');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiSkills, setApiSkills] = useState<SkillItem[]>([]);
  const [assigned, setAssigned] = useState<{ slug: string; name: string }[]>([]);
  const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [hasClaws, setHasClaws] = useState(true);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', category: 'general', version: '1.0.0', tags: '', image: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [clawList, assignList, res] = await Promise.all([
        claws.list().catch(() => []),
        tenantNum ? artifactAssignments.list('tenant', tenantNum, 'skill').catch(() => []) : [],
        listMarketplaceSkills({ limit: 100 }).catch(() => ({ skills: [] })),
      ]);
      setHasClaws(clawList.length > 0);
      setAssigned(assignList.map((a) => ({ slug: a.artifactSlug, name: a.artifactSlug })));
      setInstalledSlugs(new Set(assignList.map((a) => a.artifactSlug)));
      setApiSkills((res.skills ?? []).map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description ?? '',
        category: s.category ?? undefined,
        icon: s.icon_url ?? undefined,
        author: s.author_username ?? s.author_display_name,
      })));
      const allSlugs = [
        ...BUILTIN_SKILLS.map((b) => b.slug),
        ...(res.skills ?? []).map((s) => s.slug),
      ];
      if (allSlugs.length > 0) {
        const s = await marketplaceStats.getStats('skill', allSlugs).catch(() => ({}));
        setStats(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantNum]);

  useEffect(() => {
    setUserSkills(loadUserSkills(tenantId));
    load();
  }, [tenantId, load]);

  const assign = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.assign('skill', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => new Set([...prev, slug]));
      const updated = await marketplaceStats.getStats('skill', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
      setAssigned((prev) => {
        const name = BUILTIN_SKILLS.find((b) => b.slug === slug)?.name ?? apiSkills.find((a) => a.slug === slug)?.name ?? slug;
        if (prev.some((a) => a.slug === slug)) return prev;
        return [...prev, { slug, name }];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const unassign = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.unassign('skill', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setAssigned((prev) => prev.filter((a) => a.slug !== slug));
      const updated = await marketplaceStats.getStats('skill', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const toggleLike = async (slug: string) => {
    try {
      const liked = await marketplaceStats.toggleLike('skill', slug);
      const prev = stats[slug] ?? { likes: 0, installs: 0, liked: false };
      setStats((s) => ({ ...s, [slug]: { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Like failed');
    }
  };

  const saveSkill = () => {
    const name = createForm.name.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const skill: UserSkill = {
      id: crypto.randomUUID(),
      name,
      slug,
      description: createForm.description.trim(),
      category: createForm.category,
      version: createForm.version || '1.0.0',
      tags: createForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      shared: false,
      image: createForm.image.trim() || undefined,
      likes: 0,
      downloads: 0,
      createdAt: new Date().toISOString(),
    };
    setUserSkills((prev) => [...prev, skill]);
    saveUserSkills(tenantId, [...userSkills, skill]);
    setCreateOpen(false);
    setCreateForm({ name: '', description: '', category: 'general', version: '1.0.0', tags: '', image: '' });
    setTab('my-skills');
  };

  const deleteUserSkill = (id: string) => {
    if (!confirm('Delete this skill?')) return;
    const next = userSkills.filter((s) => s.id !== id);
    setUserSkills(next);
    saveUserSkills(tenantId, next);
  };

  const toggleShare = (id: string) => {
    const next = userSkills.map((s) => (s.id === id ? { ...s, shared: !s.shared } : s));
    setUserSkills(next);
    saveUserSkills(tenantId, next);
  };

  const builtinFiltered = BUILTIN_SKILLS.filter(
    (b) => !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.description.toLowerCase().includes(search.toLowerCase())
  );
  const apiFiltered = apiSkills.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const apiSlugSet = new Set(apiFiltered.map((s) => s.slug));
  const marketplaceItems: SkillItem[] = [
    ...apiFiltered,
    ...builtinFiltered.filter((b) => !apiSlugSet.has(b.slug)).map((b) => ({ slug: b.slug, name: b.name, description: b.description, category: b.category, icon: b.image, emoji: b.emoji, author: b.author })),
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Skills</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Extend your workforce with marketplace skills</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ Create Skill</button>
      </div>

      {error && <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <button type="button" className={`btn ${tab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assigned')}>Assigned ({assigned.length})</button>
        <button type="button" className={`btn ${tab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('marketplace')}>Marketplace ({marketplaceItems.length})</button>
        <button type="button" className={`btn ${tab === 'my-skills' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('my-skills')}>My Skills ({userSkills.length})</button>
      </div>

      {loading && tab !== 'assigned' ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : tab === 'assigned' ? (
        tenantNum ? (
          <SkillAssignmentsContent scope="tenant" scopeId={tenantNum} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-title">No tenant selected</div>
          </div>
        )
      ) : tab === 'my-skills' ? (
        userSkills.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🛠️</div>
            <div className="empty-state-title">No custom skills yet</div>
            <div className="empty-state-sub">Create your own skill and share it in the marketplace</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setCreateOpen(true)}>Create Skill</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {userSkills.map((s) => (
              <div key={s.id} className="card" style={{ overflow: 'hidden' }}>
                {s.image && <div style={{ width: '100%', height: 120, background: `url('${s.image}') center/cover`, borderBottom: '1px solid var(--border)' }} />}
                <div style={{ padding: s.image ? 12 : 0 }}>
                  <div className="card-header">
                    <div className="card-title">{s.name}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <span className="badge badge-gray">{s.category}</span>
                      <span className="badge badge-gray">v{s.version}</span>
                      {s.tags?.slice(0, 2).map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
                      {s.shared && <span className="badge badge-green">Shared</span>}
                    </div>
                  </div>
                  {s.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{s.description}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button type="button" className={`btn btn-sm ${s.shared ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggleShare(s.id)}>{s.shared ? 'Unshare' : 'Share to Marketplace'}</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteUserSkill(s.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <input type="text" className="input" style={{ maxWidth: 300 }} placeholder="Search skills…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {marketplaceItems.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">No skills found</div></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {marketplaceItems.map((s) => {
                const stat = stats[s.slug] ?? { likes: 0, installs: 0, liked: false };
                const installed = installedSlugs.has(s.slug);
                return (
                  <div key={s.slug} className="card" style={{ overflow: 'hidden' }}>
                    {s.icon && <div style={{ width: '100%', height: 100, background: `url('${s.icon}') center/cover`, borderBottom: '1px solid var(--border)' }} />}
                    <div style={{ padding: s.icon ? 12 : 0 }}>
                      <div className="card-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 32, height: 32, background: 'var(--accent-subtle)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{(s as { emoji?: string }).emoji ?? '✨'}</div>
                          <div>
                            <div className="card-title">{s.name}</div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                              {s.category && <span className="badge badge-gray" style={{ fontSize: 10 }}>{s.category}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                      {s.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{s.description}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)', margin: '4px 0 8px' }}>
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? '#ef4444' : 'var(--muted)' }} title={stat.liked ? 'Unlike' : 'Like'} onClick={() => toggleLike(s.slug)}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
                        <span>⬇️ {stat.installs}</span>
                        {s.author && <span>by {s.author}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {installed ? <button type="button" className="btn btn-danger btn-sm" onClick={() => unassign(s.slug)}>Uninstall</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => assign(s.slug)}>Install</button>}
                        <ArtifactAssigner artifactType="skill" artifactSlug={s.slug} artifactName={s.name} />
                        <Link href={`/skills/${encodeURIComponent(s.slug)}`} className="btn btn-secondary btn-sm">View</Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={() => setCreateOpen(false)}>
          <div className="card" style={{ maxWidth: 480, width: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title">Create Skill</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Name *</label>
                <input className="input" placeholder="My custom skill" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={3} placeholder="What does this skill do?" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Category</label>
                  <select className="input" value={createForm.category} onChange={(e) => setCreateForm((f) => ({ ...f, category: e.target.value }))}>
                    <option value="general">General</option>
                    <option value="coding">Coding</option>
                    <option value="testing">Testing</option>
                    <option value="devops">DevOps</option>
                    <option value="documentation">Documentation</option>
                    <option value="security">Security</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Version</label>
                  <input className="input" placeholder="1.0.0" value={createForm.version} onChange={(e) => setCreateForm((f) => ({ ...f, version: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Cover Image URL</label>
                <input className="input" placeholder="https://example.com/image.jpg" value={createForm.image} onChange={(e) => setCreateForm((f) => ({ ...f, image: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tags (comma-separated)</label>
                <input className="input" placeholder="e.g. coding, automation" value={createForm.tags} onChange={(e) => setCreateForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveSkill} disabled={!createForm.name.trim()}>Save Skill</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
