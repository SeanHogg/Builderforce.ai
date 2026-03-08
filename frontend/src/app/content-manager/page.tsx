'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/lib/AuthContext';
import { marketplaceStats, llmChat, type ArtifactStats } from '@/lib/builderforceApi';
import { contentStorageKey } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

export type ContentType = 'page' | 'template' | 'snippet';
export type ContentStatus = 'draft' | 'published';

export interface ContentVariant {
  id: string;
  label: string;
  body: string;
}

export interface ContentBlock {
  id: string;
  title: string;
  type: ContentType;
  status: ContentStatus;
  body: string;
  variant?: ContentVariant | null;
  tags: string[];
  sharedToMarketplace?: boolean;
  image?: string;
  likes?: number;
  downloads?: number;
  createdAt: string;
  updatedAt: string;
}

function loadBlocks(tenantId: string): ContentBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(contentStorageKey(tenantId));
    return raw ? (JSON.parse(raw) as ContentBlock[]) : [];
  } catch {
    return [];
  }
}

function saveBlocks(tenantId: string, blocks: ContentBlock[]) {
  localStorage.setItem(contentStorageKey(tenantId), JSON.stringify(blocks));
}

export default function ContentManagerPage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';

  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [filter, setFilter] = useState<ContentType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ContentStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [contentTab, setContentTab] = useState<'my-content' | 'marketplace'>('my-content');
  const [marketplaceSearch, setMarketplaceSearch] = useState('');
  const [contentStats, setContentStats] = useState<Record<string, ArtifactStats>>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContentBlock | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [activeVariant, setActiveVariant] = useState<'main' | 'ab'>('main');
  const [form, setForm] = useState({
    title: '',
    type: 'snippet' as ContentType,
    status: 'draft' as ContentStatus,
    body: '',
    tags: '',
    image: '',
    variantEnabled: false,
    variantLabel: 'Variant B',
    variantBody: '',
  });
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    setBlocks(loadBlocks(tenantId));
  }, [tenantId]);

  const loadContentStats = useCallback(async () => {
    const slugs = blocks.filter((b) => b.sharedToMarketplace).map((b) => b.id);
    if (slugs.length > 0) {
      const s = await marketplaceStats.getStats('content', slugs).catch(() => ({}));
      setContentStats(s);
    }
  }, [blocks]);

  useEffect(() => {
    loadContentStats();
  }, [loadContentStats]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ title: '', type: 'snippet', status: 'draft', body: '', tags: '', image: '', variantEnabled: false, variantLabel: 'Variant B', variantBody: '' });
    setPreviewMode(false);
    setActiveVariant('main');
    setGeneratePrompt('');
    setGenerateError('');
    setPanelOpen(true);
  };

  const openEdit = (block: ContentBlock) => {
    setEditTarget(block);
    setForm({
      title: block.title,
      type: block.type,
      status: block.status,
      body: block.body,
      tags: block.tags.join(', '),
      image: block.image || '',
      variantEnabled: block.variant != null,
      variantLabel: block.variant?.label ?? 'Variant B',
      variantBody: block.variant?.body ?? '',
    });
    setPreviewMode(false);
    setActiveVariant('main');
    setGeneratePrompt('');
    setGenerateError('');
    setPanelOpen(true);
  };

  const save = () => {
    const title = form.title.trim();
    if (!title) return;
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const variant: ContentVariant | null = form.variantEnabled
      ? { id: 'b', label: form.variantLabel || 'Variant B', body: form.variantBody }
      : null;
    const now = new Date().toISOString();
    let newBlocks: ContentBlock[];
    if (editTarget) {
      newBlocks = blocks.map((b) =>
        b.id === editTarget.id
          ? { ...b, title, type: form.type, status: form.status, body: form.body, tags, variant, image: form.image.trim() || undefined, updatedAt: now }
          : b
      );
    } else {
      const newBlock: ContentBlock = {
        id: crypto.randomUUID(),
        title,
        type: form.type,
        status: form.status,
        body: form.body,
        tags,
        variant,
        image: form.image.trim() || undefined,
        likes: 0,
        downloads: 0,
        createdAt: now,
        updatedAt: now,
      };
      newBlocks = [...blocks, newBlock];
    }
    setBlocks(newBlocks);
    saveBlocks(tenantId, newBlocks);
    setPanelOpen(false);
  };

  const deleteBlock = (id: string) => {
    if (!confirm('Delete this content block?')) return;
    const next = blocks.filter((b) => b.id !== id);
    setBlocks(next);
    saveBlocks(tenantId, next);
  };

  const togglePublish = (id: string) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, status: b.status === 'published' ? 'draft' as ContentStatus : 'published' as ContentStatus, updatedAt: new Date().toISOString() } : b));
    setBlocks(next);
    saveBlocks(tenantId, next);
  };

  const toggleMarketplace = (id: string) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, sharedToMarketplace: !b.sharedToMarketplace, updatedAt: new Date().toISOString() } : b));
    setBlocks(next);
    saveBlocks(tenantId, next);
  };

  const marketplaceContent = blocks.filter(
    (b) => b.sharedToMarketplace && b.status === 'published' && (!marketplaceSearch || b.title.toLowerCase().includes(marketplaceSearch.toLowerCase()) || b.body.toLowerCase().includes(marketplaceSearch.toLowerCase()))
  );

  const toggleContentLike = async (id: string) => {
    try {
      const liked = await marketplaceStats.toggleLike('content', id);
      const prev = contentStats[id] ?? { likes: 0, installs: 0, liked: false };
      setContentStats((s) => ({ ...s, [id]: { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } }));
    } catch { /* ignore */ }
  };

  const generateContent = async () => {
    const prompt = generatePrompt.trim();
    if (!prompt || generating) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const { content } = await llmChat(
        [
          { role: 'system', content: 'You are a professional content writer. Generate well-structured markdown content for the requested topic. Return only the markdown body — no titles or meta headers.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.6, maxTokens: 1000 }
      );
      const generated = content?.trim() ?? '';
      if (activeVariant === 'ab') setForm((f) => ({ ...f, variantBody: generated }));
      else setForm((f) => ({ ...f, body: generated }));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const filtered = blocks.filter((b) => {
    if (filter !== 'all' && b.type !== filter) return false;
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (search && !b.title.toLowerCase().includes(search.toLowerCase()) && !b.body.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const bodyValue = activeVariant === 'ab' ? form.variantBody : form.body;
  const marketplaceCount = blocks.filter((b) => b.sharedToMarketplace).length;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 48px' }}>
      {/* Page header: title + description on left, "New content" on right when My Content tab */}
      <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Content Manager</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Manage reusable markdown content blocks with A/B variants and audience targeting.
          </p>
        </div>
        {contentTab === 'my-content' && (
          <button type="button" className="btn btn-primary" onClick={openCreate} style={{ flexShrink: 0 }}>
            + New content
          </button>
        )}
      </div>

      {/* Primary tabs: My Content (N) | Marketplace (N) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        <button
          type="button"
          className={`btn btn-sm ${contentTab === 'my-content' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setContentTab('my-content')}
        >
          My Content ({blocks.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${contentTab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setContentTab('marketplace')}
        >
          Marketplace ({marketplaceCount})
        </button>
      </div>

      {contentTab === 'my-content' ? (
        <>
          {/* Search bar (wide) */}
          <div style={{ marginBottom: 16 }}>
            <input
              type="search"
              className="input"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', maxWidth: 480, padding: '8px 12px', borderRadius: 8 }}
              aria-label="Search content"
            />
          </div>
          {/* Type filters */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>Type</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'page', 'template', 'snippet'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={filter === t ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setFilter(t)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {t === 'all' ? 'All types' : t}
                </button>
              ))}
            </div>
          </div>
          {/* Status filters */}
          <div style={{ marginBottom: 20 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>Status</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'published', 'draft'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={statusFilter === s ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {s === 'all' ? 'All status' : s}
                </button>
              ))}
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div className="empty-state-icon" style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>
                <span role="img" aria-hidden style={{ display: 'inline-block' }}>📄</span>
              </div>
              <div className="empty-state-title" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 8 }}>No content blocks yet</div>
              <div className="empty-state-sub" style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 360, margin: '0 auto 20px' }}>
                Create pages, templates, and snippets to manage your content centrally
              </div>
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                Create content
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filtered.map((b) => {
                const stat = contentStats[b.id] ?? { likes: b.likes ?? 0, installs: b.downloads ?? 0, liked: false };
                return (
                  <div key={b.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
                    {b.image && <div style={{ height: 100, background: `url('${b.image}') center/cover`, borderBottom: '1px solid var(--border)', margin: '-16px -16px 0', width: 'calc(100% + 32px)' }} />}
                    <div className="card-header">
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.title}>{b.title}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="badge badge-gray">{b.type}</span>
                          <span className={`badge ${b.status === 'published' ? 'badge-green' : 'badge-yellow'}`}>{b.status}</span>
                          {b.variant && <span className="badge badge-blue" title="A/B variant">A/B</span>}
                          {b.tags.slice(0, 2).map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
                        </div>
                      </div>
                    </div>
                    {b.body && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{b.body.slice(0, 160)}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? 'var(--error)' : 'var(--muted)' }} onClick={() => toggleContentLike(b.id)}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
                      <span>⬇️ {stat.installs}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(b)}>Edit</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => togglePublish(b.id)}>{b.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                      {b.status === 'published' && (
                        <button type="button" className={`btn btn-sm ${b.sharedToMarketplace ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggleMarketplace(b.id)}>{b.sharedToMarketplace ? 'Unshare' : 'Share to Marketplace'}</button>
                      )}
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteBlock(b.id)}>Delete</button>
                      <ArtifactAssigner artifactType="content" artifactSlug={b.id} artifactName={b.title} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Updated {new Date(b.updatedAt).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <input
              type="search"
              className="input"
              placeholder="Search..."
              value={marketplaceSearch}
              onChange={(e) => setMarketplaceSearch(e.target.value)}
              style={{ width: '100%', maxWidth: 480, padding: '8px 12px', borderRadius: 8 }}
              aria-label="Search marketplace content"
            />
          </div>
          {marketplaceContent.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div className="empty-state-icon" style={{ fontSize: 48, marginBottom: 16 }}>🏪</div>
              <div className="empty-state-title" style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 8 }}>No marketplace content yet</div>
              <div className="empty-state-sub" style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 360, margin: '0 auto 20px' }}>
                Publish your content blocks and share them in the marketplace
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setContentTab('my-content')}>
                Go to My Content
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {marketplaceContent.map((b) => {
                const stat = contentStats[b.id] ?? { likes: 0, installs: 0, liked: false };
                return (
                  <div key={b.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="card-header">
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="badge badge-gray">{b.type}</span>
                          <span className="badge badge-green">Published</span>
                          <span className="badge badge-blue">Marketplace</span>
                          {b.tags.slice(0, 2).map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
                        </div>
                      </div>
                      <ArtifactAssigner artifactType="content" artifactSlug={b.id} artifactName={b.title} />
                    </div>
                    {b.body && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{b.body.slice(0, 160)}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: stat.liked ? 'var(--error)' : 'var(--muted)' }} onClick={() => toggleContentLike(b.id)}>{stat.liked ? '❤️' : '🤍'} {stat.likes}</button>
                      <span>⬇️ {stat.installs}</span>
                    </div>
                    <Link href={`/content-manager/${encodeURIComponent(b.id)}`} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>View</Link>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {panelOpen && (
        <div className="modal-overlay" onClick={() => setPanelOpen(false)}>
          <div className="card" style={{ maxWidth: 780, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="modal-title">{editTarget ? 'Edit content' : 'New content block'}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanelOpen(false)}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'end' }}>
                <div>
                  <label className="label">Title</label>
                  <input className="input" placeholder="Content title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ContentType }))}>
                    <option value="snippet">Snippet</option>
                    <option value="page">Page</option>
                    <option value="template">Template</option>
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ContentStatus }))}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Audience tags (comma-separated)</label>
                <input className="input" placeholder="free, pro, mobile" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <div>
                <label className="label">Cover Image URL</label>
                <input className="input" placeholder="https://example.com/image.jpg" value={form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={form.variantEnabled} onChange={(e) => setForm((f) => ({ ...f, variantEnabled: e.target.checked }))} />
                  Enable A/B variant
                </label>
                {form.variantEnabled && <input className="input" style={{ maxWidth: 200 }} placeholder="Variant B label" value={form.variantLabel} onChange={(e) => setForm((f) => ({ ...f, variantLabel: e.target.value }))} />}
              </div>
              {form.variantEnabled && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className={`btn btn-sm ${activeVariant === 'main' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveVariant('main')}>Main (A)</button>
                  <button type="button" className={`btn btn-sm ${activeVariant === 'ab' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveVariant('ab')}>{form.variantLabel || 'Variant B'}</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label className="label">Generate with AI</label>
                  <input className="input" placeholder='Describe what to generate, e.g. "Onboarding guide for developers"' value={generatePrompt} onChange={(e) => setGeneratePrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generateContent()} />
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={generating || !generatePrompt.trim()} onClick={generateContent}>{generating ? 'Generating…' : '✨ Generate'}</button>
              </div>
              {generateError && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{generateError}</div>}
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className={`btn btn-sm ${!previewMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPreviewMode(false)}>Edit</button>
                <button type="button" className={`btn btn-sm ${previewMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPreviewMode(true)}>Preview</button>
              </div>
              {previewMode ? (
                <div className="card" style={{ minHeight: 260, padding: 16 }}>
                  <div className="md-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyValue}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 260, resize: 'vertical', whiteSpace: 'pre' }} placeholder="Write Markdown content here…" value={bodyValue} onChange={(e) => { const val = e.target.value; if (activeVariant === 'ab') setForm((f) => ({ ...f, variantBody: val })); else setForm((f) => ({ ...f, body: val })); }} />
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>{editTarget ? 'Save changes' : 'Create content'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
