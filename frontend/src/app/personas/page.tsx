'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { contrastText } from '@/lib/contrastText';
import {
  artifactAssignments,
  marketplaceStats,
  agentHosts,
  personasApi,
  type ArtifactAssignment,
  type ArtifactStats,
  type PublicPersona,
} from '@/lib/builderforceApi';
import { BUILTIN_PERSONAS, userPersonasKey, type Persona, type UserPersona } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import PsychometricEditor from '@/components/PsychometricEditor';
import type { PsychometricProfile } from '@/lib/psychometric';
import PageContainer from '@/components/PageContainer';
import { PersonaAssignmentsContent } from '@/components/PersonaAssignmentsContent';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

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

/** Map a server-published persona into the marketplace display shape (`Persona`).
 *  The behaviour fields live NESTED under `persona` (server contract), not flat. */
function publicToPersona(p: PublicPersona): Persona {
  const b = p.persona ?? {};
  return {
    name: p.slug || p.name,
    description: p.description ?? '',
    voice: b.voice || '—',
    perspective: b.perspective || '—',
    decisionStyle: b.decisionStyle || '—',
    outputPrefix: b.outputPrefix ?? '',
    capabilities: b.capabilities ?? [],
    source: 'user-global',
    tags: p.tags ?? [],
    author: p.authorName ?? 'Community',
    image: b.image,
    likes: p.likeCount,
    downloads: p.installCount,
    psychometric: p.psychometric ?? undefined,
  };
}

export default function PersonasPage() {
  const t = useTranslations('personasPage');
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [tab, setTab] = useState<'assigned' | 'marketplace' | 'my-personas'>('assigned');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [userPersonas, setUserPersonas] = useState<UserPersona[]>([]);
  // Public personas from the server registry (GET /api/personas/public). Empty on
  // an older backend; the builtins are always shown so the tab is never blank.
  const [publicPersonas, setPublicPersonas] = useState<Persona[]>([]);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ArtifactStats>>({});
  const [hasAgentHosts, setHasAgentHosts] = useState(true);
  const [installedSlugs, setInstalledSlugs] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createPsychometric, setCreatePsychometric] = useState<PsychometricProfile | undefined>(undefined);
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
      const [all, agentHostList, pub] = await Promise.all([
        tenantNum ? artifactAssignments.list('tenant', tenantNum, 'persona').catch(() => []) : [],
        agentHosts.list().catch(() => []),
        // Public registry is best-effort: [] on 404/older backend so builtins still render.
        personasApi.listPublic().catch(() => [] as PublicPersona[]),
      ]);
      setAssigned(all);
      setHasAgentHosts(agentHostList.length > 0);
      setInstalledSlugs(new Set(all.map((a) => a.artifactSlug)));
      // Server personas first, then builtins not already present (dedup by slug/name).
      const serverPersonas = pub.map(publicToPersona);
      const serverSlugs = new Set(serverPersonas.map((p) => p.name));
      setPublicPersonas(serverPersonas);
      const slugs = [...serverSlugs, ...BUILTIN_PERSONAS.map((p) => p.name).filter((n) => !serverSlugs.has(n))];
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
      psychometric: createPsychometric,
    };
    setUserPersonas((prev) => [...prev, persona]);
    saveUserPersonas(tenantId, [...userPersonas, persona]);
    setCreateOpen(false);
    setCreateForm({ name: '', description: '', voice: '', perspective: '', decisionStyle: '', outputPrefix: '', capabilities: '', tags: '', image: '' });
    setCreatePsychometric(undefined);
    setTab('my-personas');
  };

  const deleteUserPersona = (id: string) => {
    if (!confirm('Delete this persona?')) return;
    const next = userPersonas.filter((p) => p.id !== id);
    setUserPersonas(next);
    saveUserPersonas(tenantId, next);
  };

  /** Publish a local draft persona to the public server registry (POST /api/personas),
   *  then refresh so it appears in the Marketplace tab. Also flips the local `shared`
   *  flag so the draft layer reflects the published state. Degrades gracefully:
   *  errors surface in the page banner and leave the draft intact. */
  const publishPersona = async (p: UserPersona) => {
    setPublishingId(p.id);
    setError('');
    try {
      await personasApi.publish({
        name: p.name,
        description: p.description,
        tags: p.tags,
        // Publish makes it browsable in the Marketplace tab (server default is private).
        visibility: 'public',
        // Behaviour fields are sent NESTED under `persona` (server contract).
        persona: {
          voice: p.voice,
          perspective: p.perspective,
          decisionStyle: p.decisionStyle,
          outputPrefix: p.outputPrefix,
          capabilities: p.capabilities,
          image: p.image,
        },
        // The personality the user built from the test / sliders — was previously dropped.
        psychometric: p.psychometric,
      });
      const next = userPersonas.map((u) => (u.id === p.id ? { ...u, shared: true } : u));
      setUserPersonas(next);
      saveUserPersonas(tenantId, next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishingId(null);
    }
  };

  // Marketplace listing = server registry personas + builtins not already published.
  const serverSlugs = new Set(publicPersonas.map((p) => p.name));
  const marketplacePersonas: Persona[] = [
    ...publicPersonas,
    ...BUILTIN_PERSONAS.filter((p) => !serverSlugs.has(p.name)),
  ];

  const filteredMarketplace = marketplacePersonas.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      (p.tags ?? []).some((t) => t.includes(search.toLowerCase()))
  );

  const insightsItems: CatalogInsightsItem[] = marketplacePersonas.map((p) => {
    const stat = stats[p.name] ?? { likes: 0, installs: 0, liked: false };
    return { key: p.name, name: p.name, group: p.source ?? null, primary: stat.installs, secondary: stat.likes };
  });

  const sourceBadge = (source: Persona['source']) => {
    const map: Record<string, { label: string; color: string }> = {
      builtin: { label: 'Built-in', color: 'var(--accent,#6366f1)' },
      agenthub: { label: 'AgentHostHub', color: '#22c55e' },
      'project-local': { label: 'Project', color: '#f59e0b' },
      'user-global': { label: 'User', color: '#06b6d4' },
      'agentlink-assigned': { label: 'Assigned', color: '#ec4899' },
    };
    const m = map[source] ?? { label: source, color: 'var(--muted)' };
    return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: m.color, color: contrastText(m.color), textTransform: 'uppercase' }}>{m.label}</span>;
  };

  return (
    <PageContainer width="readable">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>
            {t('subtitle')}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          {t('newPersona')}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, alignItems: 'center' }}>
        <button type="button" className={`btn ${tab === 'assigned' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('assigned')}>
          {t('tabAssigned', { n: assigned.length })}
        </button>
        <button type="button" className={`btn ${tab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('marketplace')}>
          {t('tabMarketplace', { n: marketplacePersonas.length })}
        </button>
        <button type="button" className={`btn ${tab === 'my-personas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('my-personas')}>
          {t('tabMyPersonas', { n: userPersonas.length })}
        </button>
        {tab !== 'assigned' && (
          <div style={{ marginLeft: 'auto' }}>
            <ViewToggle value={viewMode} onChange={setViewMode} />
          </div>
        )}
      </div>

      {loading && tab !== 'assigned' ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('loading')}</div>
      ) : tab === 'assigned' ? (
        tenantNum ? (
          <PersonaAssignmentsContent scope="tenant" scopeId={tenantNum} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-title">{t('noTenant')}</div>
          </div>
        )
      ) : tab === 'my-personas' ? (
        userPersonas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎭</div>
            <div className="empty-state-title">{t('noCustomTitle')}</div>
            <div className="empty-state-sub">{t('noCustomSub')}</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setCreateOpen(true)}>{t('newPersonaShort')}</button>
          </div>
        ) : viewMode === 'card' ? (
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
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={publishingId === p.id} onClick={() => publishPersona(p)}>
                      {publishingId === p.id ? 'Publishing…' : p.shared ? 'Re-publish' : 'Publish to Registry'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteUserPersona(p.id)}>Delete</button>
                    <ArtifactAssigner artifactType="persona" artifactSlug={p.slug} artifactName={p.name} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Tags</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {userPersonas.map((p) => (
                  <tr key={p.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ marginRight: 6 }}>🎭</span>{p.name}
                      {p.shared && <span className="badge badge-green" style={{ marginLeft: 6 }}>Shared</span>}
                    </td>
                    <td style={tdMutedStyle}>{p.description || '—'}</td>
                    <td style={tdMutedStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.tags.length ? p.tags.map((t) => <span key={t} className="badge badge-gray">{t}</span>) : '—'}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-primary btn-sm" disabled={publishingId === p.id} onClick={() => publishPersona(p)}>{publishingId === p.id ? 'Publishing…' : p.shared ? 'Re-publish' : 'Publish'}</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteUserPersona(p.id)}>Delete</button>
                        <ArtifactAssigner artifactType="persona" artifactSlug={p.slug} artifactName={p.name} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          <CatalogInsightsBar entity="personas" items={insightsItems} primaryMetric="installs" secondaryMetric="likes" groupKind="source" />
          <div style={{ marginBottom: 16 }}>
            <input
              type="search"
              className="input"
              style={{ maxWidth: 320 }}
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredMarketplace.length === 0 ? (
            <div className="empty-state"><div className="empty-state-title">{t('noPersonasFound')}</div></div>
          ) : viewMode === 'card' ? (
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
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? 'var(--error)' : 'var(--muted)' }} title={stat.liked ? 'Unlike' : 'Like'} onClick={(e) => { e.stopPropagation(); toggleLike(p.name); }}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
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
          ) : (
            <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Description</th>
                    <th style={thStyle}>Source / Tags</th>
                    <th style={thStyle}>Stats</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMarketplace.map((p) => {
                    const stat = stats[p.name] ?? { likes: 0, installs: 0, liked: false };
                    const installed = installedSlugs.has(p.name);
                    return (
                      <tr key={p.name} style={trStyle}>
                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <span style={{ marginRight: 6 }}>🎭</span>{p.name}
                        </td>
                        <td style={tdMutedStyle}>{p.description || '—'}</td>
                        <td style={tdMutedStyle}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {sourceBadge(p.source)}
                            {(p.tags ?? []).slice(0, 2).map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
                          </div>
                        </td>
                        <td style={{ ...tdMutedStyle, whiteSpace: 'nowrap' }}>
                          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? 'var(--error)' : 'var(--muted)' }} title={stat.liked ? 'Unlike' : 'Like'} onClick={() => toggleLike(p.name)}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
                          <span style={{ marginLeft: 10, fontSize: 11 }}>⬇️ {stat.installs}</span>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <div className="modal-overlay" onClick={() => setCreateOpen(false)}>
          <div className="card" style={{ maxWidth: 540, width: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title">{t('newPersonaShort')}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="label">{t('formName')}</label>
                <input className="input" placeholder={t('formNamePlaceholder')} value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formDescription')}</label>
                <textarea className="input" rows={2} placeholder={t('formDescPlaceholder')} value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('formVoice')}</label>
                  <input className="input" placeholder={t('formVoicePlaceholder')} value={createForm.voice} onChange={(e) => setCreateForm((f) => ({ ...f, voice: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">{t('formOutputPrefix')}</label>
                  <input className="input" placeholder={t('formOutputPrefixPlaceholder')} value={createForm.outputPrefix} onChange={(e) => setCreateForm((f) => ({ ...f, outputPrefix: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">{t('formPerspective')}</label>
                <input className="input" placeholder={t('formPerspectivePlaceholder')} value={createForm.perspective} onChange={(e) => setCreateForm((f) => ({ ...f, perspective: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formDecisionStyle')}</label>
                <input className="input" placeholder={t('formDecisionStylePlaceholder')} value={createForm.decisionStyle} onChange={(e) => setCreateForm((f) => ({ ...f, decisionStyle: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formCapabilities')}</label>
                <input className="input" placeholder={t('formCapabilitiesPlaceholder')} value={createForm.capabilities} onChange={(e) => setCreateForm((f) => ({ ...f, capabilities: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formTags')}</label>
                <input className="input" placeholder={t('formTagsPlaceholder')} value={createForm.tags} onChange={(e) => setCreateForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('formCoverImage')}</label>
                <input className="input" placeholder="https://example.com/image.jpg" value={createForm.image} onChange={(e) => setCreateForm((f) => ({ ...f, image: e.target.value }))} />
              </div>
              <PsychometricEditor value={createPsychometric} onChange={setCreatePsychometric} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={savePersona} disabled={!createForm.name.trim()}>{t('savePersona')}</button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
