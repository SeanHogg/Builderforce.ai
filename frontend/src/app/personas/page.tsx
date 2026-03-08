'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import {
  artifactAssignments,
  marketplaceStats,
  claws,
  type ArtifactAssignment,
  type ArtifactStats,
} from '@/lib/builderforceApi';
import { BUILTIN_PERSONAS, userPersonasKey, type Persona, type UserPersona } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

function loadUserPersonas(tenantId: string): UserPersona[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(userPersonasKey(tenantId)) ?? '[]');
  } catch {
    return [];
  }
}

function saveUserPersonas(tenantId: string, personas: UserPersona[]) {
  localStorage.setItem(userPersonasKey(tenantId), JSON.stringify(personas));
}

export default function PersonasPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [tab, setTab] = useState<'assigned' | 'marketplace' | 'my-personas'>('assigned');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [userPersonas, setUserPersonas] = useState<UserPersona[]>([]);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [hasClaws, setHasClaws] = useState(true);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    voice: '',
    perspective: '',
    decisionStyle: '',
    outputPrefix: '',
    capabilities: '',
    tags: '',
    image: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [all, clawList] = await Promise.all([
        tenantNum ? artifactAssignments.list('tenant', tenantNum, 'persona').catch(() => []) : [],
        claws.list().catch(() => []),
      ]);
      setAssigned(all);
      setHasClaws(clawList.length > 0);
      setInstalledSlugs(new Set(all.map((a) => a.artifactSlug)));
      const slugs = BUILTIN_PERSONAS.map((p) => p.name);
      if (slugs.length > 0) {
        const s = await marketplaceStats.getStats('persona', slugs).catch(() => ({}));
        setStats(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantNum]);

  useEffect(() => {
    setUserPersonas(loadUserPersonas(tenantId));
    load();
  }, [tenantId, load]);

  const assignPersona = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.assign('persona', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => new Set([...prev, slug]));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const unassignPersona = async (slug: string) => {
    if (!tenantNum) return;
    try {
      await artifactAssignments.unassign('persona', slug, 'tenant', tenantNum);
      setInstalledSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
      setAssigned((prev) => prev.filter((a) => a.artifactSlug !== slug));
      const updated = await marketplaceStats.getStats('persona', [slug]).catch(() => ({}));
      setStats((s) => ({ ...s, ...updated }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const toggleLike = async (slug: string) => {
    try {
      const liked = await marketplaceStats.toggleLike('persona', slug);
      const prev = stats[slug] ?? { likes: 0, installs: 0, liked: false };
      setStats((s) => ({
        ...s,
        [slug]: { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Like failed');
    }
  };

  const savePersona = () => {
    const name = createForm.name.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const persona: UserPersona = {
      id: crypto.randomUUID(),
      name,
      slug,
      description: createForm.description.trim(),
      voice: createForm.voice.trim() || 'neutral and helpful',
      perspective: createForm.perspective.trim() || 'balanced and pragmatic',
      decisionStyle: createForm.decisionStyle.trim() || 'collaborative',
      outputPrefix: createForm.outputPrefix.trim() || `${slug.toUpperCase()}:`,
      capabilities: createForm.capabilities.split(',').map((c) => c.trim()).filter(Boolean),
      tags: createForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      shared: false,
      image: createForm.image.trim() || undefined,
      likes: 0,
      downloads: 0,
      createdAt: new Date().toISOString(),
    };
    setUserPersonas((prev) => [...prev, persona]);
    saveUserPersonas(tenantId, [...userPersonas, persona]);
    setCreateOpen(false);
    setCreateForm({ name: '', description: '', voice: '', perspective: '', decisionStyle: '', outputPrefix: '', capabilities: '', tags: '', image: '' });
    setTab('my-personas');
  };

  const deleteUserPersona = (id: string) => {
    if (!confirm('Delete this persona?')) return;
    const next = userPersonas.filter((p) => p.id !== id);
    setUserPersonas(next);
    saveUserPersonas(tenantId, next);
  };

  const toggleShare = (id: string) => {
    const next = userPersonas.map((p) => (p.id === id ? { ...p, shared: !p.shared } : p));
    setUserPersonas(next);
    saveUserPersonas(tenantId, next);
  };

  const filteredMarketplace = BUILTIN_PERSONAS.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      (p.tags ?? []).some((t) => t.includes(search.toLowerCase()))
  );

  const sourceBadge = (source: Persona['source']) => {
    const map: Record<string, { label: string; color: string }> = {
      builtin: { label: 'Built-in', color: 'var(--accent,#6366f1)' },
      clawhub: { label: 'ClawHub', color: '#22c55e' },
      'project-local': { label: 'Project', color: '#f59e0b' },
      'user-global': { label: 'User', color: '#06b6d4' },
      'clawlink-assigned': { label: 'Assigned', color: '#ec4899' },
    };
    const m = map[source] ?? { label: source, color: 'var(--muted)' };
    return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: m.color, color: '#fff', textTransform: 'uppercase' }}>{m.label}</span>;
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Personas</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Agent personas shape identity, tone, and decision-making for every sub-agent in a workflow
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + Create Persona
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <button type="button" className={`btn ${tab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assigned')}>
          Assigned ({assigned.length})
        </button>
        <button type="button" className={`btn ${tab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('marketplace')}>
          Marketplace ({BUILTIN_PERSONAS.length})
        </button>
        <button type="button" className={`btn ${tab === 'my-personas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('my-personas')}>
          My Personas ({userPersonas.length})
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : tab === 'assigned' ? (
        !hasClaws ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-title">No claws registered</div>
            <div className="empty-state-sub">Register a claw (workforce) to start assigning personas</div>
          </div>
        ) : assigned.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <div className="empty-state-title">No personas assigned</div>
            <div className="empty-state-sub">Browse the marketplace to assign personas to your workspace</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setTab('marketplace')}>Browse marketplace</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {assigned.map((a) => {
              const builtin = BUILTIN_PERSONAS.find((b) => b.name === a.artifactSlug);
              return (
                <div key={a.artifactSlug} className="card">
                  <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>🎭</span>
                      <div>
                        <div className="card-title">{builtin?.name ?? a.artifactSlug}</div>
                        {builtin && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{builtin.description}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <ArtifactAssigner artifactType="persona" artifactSlug={a.artifactSlug} artifactName={a.artifactSlug} />
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => unassignPersona(a.artifactSlug)}>Remove</button>
                    </div>
                  </div>
                  {builtin && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {builtin.capabilities.map((c) => (
                        <span key={c} className="badge badge-gray">{c}</span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Assigned {new Date(a.assignedAt).toLocaleDateString()}</div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'my-personas' ? (
        userPersonas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <div className="empty-state-title">No custom personas yet</div>
            <div className="empty-state-sub">Create your own persona to shape how your agents think and communicate</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setCreateOpen(true)}>Create Persona</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {userPersonas.map((p) => (
              <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
                {p.image && <div style={{ width: '100%', height: 100, background: `url('${p.image}') center/cover`, borderBottom: '1px solid var(--border)' }} />}
                <div style={{ padding: p.image ? 12 : 0 }}>
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>🎭</span>
                      <div>
                        <div className="card-title">{p.name}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          {p.tags.slice(0, 3).map((t) => (
                            <span key={t} className="badge badge-gray">{t}</span>
                          ))}
                          {p.shared && <span className="badge badge-green">Shared</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  {p.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{p.description}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button type="button" className={`btn btn-sm ${p.shared ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggleShare(p.id)}>
                      {p.shared ? 'Unshare' : 'Share to Marketplace'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteUserPersona(p.id)}>Delete</button>
                    <ArtifactAssigner artifactType="persona" artifactSlug={p.slug} artifactName={p.name} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              className="input"
              style={{ maxWidth: 300 }}
              placeholder="Search personas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredMarketplace.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">No personas found</div></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filteredMarketplace.map((p) => {
                const stat = stats[p.name] ?? { likes: 0, installs: 0, liked: false };
                const installed = installedSlugs.has(p.name);
                const isOpen = expanded === p.name;
                return (
                  <div key={p.name} className="card" style={{ overflow: 'hidden', borderColor: isOpen ? 'var(--accent,#6366f1)' : undefined }}>
                    {p.image && <div style={{ width: '100%', height: 100, background: `url('${p.image}') center/cover`, borderBottom: '1px solid var(--border)' }} />}
                    <div style={{ padding: p.image ? 12 : 0 }} onClick={() => setExpanded(isOpen ? null : p.name)}>
                      <div className="card-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 20 }}>🎭</span>
                          <div>
                            <div className="card-title">{p.name}</div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                              {sourceBadge(p.source)}
                              {(p.tags ?? []).slice(0, 2).map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
                            </div>
                          </div>
                        </div>
                      </div>
                      {p.description && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '8px 0' }}>{p.description}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)', margin: '4px 0 8px' }}>
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? '#ef4444' : 'var(--muted)' }} title={stat.liked ? 'Unlike' : 'Like'} onClick={(e) => { e.stopPropagation(); toggleLike(p.name); }}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
                        <span title="Installs">⬇️ {stat.installs}</span>
                        {p.author && <span>by {p.author}</span>}
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 10 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 3 }}>Voice</div>
                              <div style={{ fontSize: 12, color: 'var(--text)' }}>{p.voice}</div>
                            </div>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 3 }}>Perspective</div>
                              <div style={{ fontSize: 12, color: 'var(--text)' }}>{p.perspective}</div>
                            </div>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 3 }}>Decision Style</div>
                              <div style={{ fontSize: 12, color: 'var(--text)' }}>{p.decisionStyle}</div>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Capabilities</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{p.capabilities.map((c) => <span key={c} className="badge badge-gray">{c}</span>)}</div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Output prefix: <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{p.outputPrefix}</code></div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 0 4px' }} onClick={(e) => e.stopPropagation()}>
                      {installed ? (
                        <>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => unassignPersona(p.name)}>Uninstall</button>
                          <ArtifactAssigner artifactType="persona" artifactSlug={p.name} artifactName={p.name} />
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => assignPersona(p.name)}>Install</button>
                          <ArtifactAssigner artifactType="persona" artifactSlug={p.name} artifactName={p.name} />
                          <Link href={`/personas/${encodeURIComponent(p.name)}`} className="btn btn-secondary btn-sm">View</Link>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {createOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setCreateOpen(false)}>
          <div className="card" style={{ maxWidth: 540, width: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title">Create Persona</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">Name *</label>
                <input className="input" placeholder="e.g. security-auditor" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} placeholder="What does this persona do?" value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Voice</label>
                  <input className="input" placeholder="e.g. cautious and thorough" value={createForm.voice} onChange={(e) => setCreateForm((f) => ({ ...f, voice: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Output Prefix</label>
                  <input className="input" placeholder="e.g. SECURITY:" value={createForm.outputPrefix} onChange={(e) => setCreateForm((f) => ({ ...f, outputPrefix: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Perspective</label>
                <input className="input" placeholder="How this persona views the world" value={createForm.perspective} onChange={(e) => setCreateForm((f) => ({ ...f, perspective: e.target.value }))} />
              </div>
              <div>
                <label className="label">Decision Style</label>
                <input className="input" placeholder="How this persona makes decisions" value={createForm.decisionStyle} onChange={(e) => setCreateForm((f) => ({ ...f, decisionStyle: e.target.value }))} />
              </div>
              <div>
                <label className="label">Capabilities (comma-separated)</label>
                <input className="input" placeholder="e.g. Vulnerability scanning, Threat modeling" value={createForm.capabilities} onChange={(e) => setCreateForm((f) => ({ ...f, capabilities: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tags (comma-separated)</label>
                <input className="input" placeholder="e.g. security, compliance" value={createForm.tags} onChange={(e) => setCreateForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <div>
                <label className="label">Cover Image URL</label>
                <input className="input" placeholder="https://example.com/image.jpg" value={createForm.image} onChange={(e) => setCreateForm((f) => ({ ...f, image: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={savePersona} disabled={!createForm.name.trim()}>Save Persona</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
