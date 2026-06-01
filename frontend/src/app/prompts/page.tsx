'use client';

import { useEffect, useState } from 'react';
import {
  promptLibraryApi,
  type PromptSummary,
  type PromptPublicView,
  type PromptEntry,
  type CreatePromptBody,
} from '@/lib/builderforceApi';
import { getStoredUser } from '@/lib/auth';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-muted, rgba(255,255,255,0.03))', border: '1px solid var(--border-subtle)', color: 'inherit',
};

type Tab = 'public' | 'mine';

export default function PromptsPage() {
  const isAuthed = !!getStoredUser();
  const [tab, setTab] = useState<Tab>('public');
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popular' | 'recent' | 'featured'>('popular');
  const [selected, setSelected] = useState<PromptPublicView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadPublic = (search?: string) => {
    setLoading(true);
    setError(null);
    promptLibraryApi.browsePublic({ q: search, sort })
      .then(setPrompts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadMine = () => {
    setLoading(true);
    setError(null);
    promptLibraryApi.list()
      .then((rows: PromptEntry[]) => setPrompts(rows))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { tab === 'public' ? loadPublic(q) : loadMine(); }, [tab, sort]);

  const openDetail = async (p: PromptSummary) => {
    try {
      const view = await promptLibraryApi.getPublic(p.slug);
      setSelected(view);
    } catch {
      // Non-public (own private prompt) — fall back to authed fetch by id.
      const full = await promptLibraryApi.get((p as PromptEntry).id);
      const v = full.versions?.find((x) => x.version === full.currentVersion);
      setSelected({ ...full, body: v?.body ?? '', variables: v?.variables ?? [], model: v?.model ?? null } as PromptPublicView);
    }
  };

  const applyPrompt = async (p: PromptPublicView) => {
    try {
      const fresh = await promptLibraryApi.usePublic(p.slug);
      await navigator.clipboard.writeText(fresh.body).catch(() => {});
      setToast('Prompt copied to clipboard');
      setSelected(fresh);
      setPrompts((prev) => prev.map((x) => (x.slug === p.slug ? { ...x, usageCount: fresh.usageCount } : x)));
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to use prompt');
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Prompt Library</h1>
        {isAuthed && (
          <button onClick={() => setShowCreate((v) => !v)} style={primaryBtn}>
            {showCreate ? 'Close' : '+ New prompt'}
          </button>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 16, fontSize: 14 }}>
        Browse and use community prompt templates. {isAuthed ? 'Publish your own to share them with everyone.' : 'Sign in to publish and star prompts.'}
      </p>

      {showCreate && isAuthed && (
        <CreatePromptForm
          onCreated={() => { setShowCreate(false); setTab('mine'); loadMine(); }}
          onError={setError}
        />
      )}

      {/* Tabs + search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <Seg active={tab === 'public'} onClick={() => setTab('public')}>Public gallery</Seg>
        {isAuthed && <Seg active={tab === 'mine'} onClick={() => setTab('mine')}>My prompts</Seg>}
        <span style={{ flex: 1 }} />
        {tab === 'public' && (
          <>
            <input
              style={{ ...input, width: 220 }}
              placeholder="Search prompts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadPublic(q); }}
            />
            <select style={{ ...input, width: 130 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="popular">Most used</option>
              <option value="recent">Newest</option>
              <option value="featured">Featured</option>
            </select>
          </>
        )}
      </div>

      {loading && <div style={card}>Loading prompts…</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {prompts.map((p) => (
            <button key={p.id} onClick={() => openDetail(p)} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{p.title}</span>
                {p.isFeatured && <span title="Featured">⭐</span>}
              </div>
              {p.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {p.category && <Tag>{p.category}</Tag>}
                {p.tags.slice(0, 3).map((t) => <Tag key={t}>#{t}</Tag>)}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>▶ {p.usageCount.toLocaleString()} uses</span>
                <span>★ {p.starCount}</span>
                {p.authorName && <span>by {p.authorName}</span>}
              </div>
            </button>
          ))}
          {prompts.length === 0 && (
            <div style={{ ...card, gridColumn: '1 / -1', color: 'var(--text-muted)' }}>
              {tab === 'mine' ? 'You have no prompts yet. Click “+ New prompt” to create one.' : 'No public prompts found.'}
            </div>
          )}
        </div>
      )}

      {selected && (
        <PromptDetail
          prompt={selected}
          isAuthed={isAuthed}
          onClose={() => setSelected(null)}
          onUse={() => applyPrompt(selected)}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', padding: '10px 18px', borderRadius: 999, fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.3)', zIndex: 100 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function PromptDetail({ prompt, isAuthed, onClose, onUse }: { prompt: PromptPublicView; isAuthed: boolean; onClose: () => void; onUse: () => void }) {
  const [starred, setStarred] = useState(false);
  const id = (prompt as PromptPublicView & { id: string }).id;

  const toggleStar = async () => {
    try {
      if (starred) { await promptLibraryApi.unstar(id); setStarred(false); }
      else { await promptLibraryApi.star(id); setStarred(true); }
    } catch { /* ignore */ }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', background: 'var(--bg-base)', borderLeft: '1px solid var(--border-subtle)', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{prompt.title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        {prompt.description && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{prompt.description}</p>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 16px' }}>
          {prompt.category && <Tag>{prompt.category}</Tag>}
          {prompt.tags.map((t) => <Tag key={t}>#{t}</Tag>)}
          {prompt.model && <Tag>model: {prompt.model}</Tag>}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <button onClick={onUse} style={primaryBtn}>Use this prompt (copy)</button>
          {isAuthed && id && <button onClick={toggleStar} style={ghostBtn}>{starred ? '★ Starred' : '☆ Star'}</button>}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>PROMPT (v{prompt.currentVersion})</div>
        <pre style={{ ...card, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, fontFamily: 'ui-monospace, monospace', maxHeight: 360, overflowY: 'auto' }}>{prompt.body}</pre>

        {prompt.variables.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '16px 0 6px' }}>VARIABLES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prompt.variables.map((v) => (
                <div key={v.name} style={{ ...card, padding: 10, fontSize: 13 }}>
                  <code style={{ fontWeight: 700 }}>{`{{${v.name}}}`}</code>
                  {v.description && <span style={{ color: 'var(--text-muted)' }}> — {v.description}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
          <span>▶ {prompt.usageCount.toLocaleString()} uses</span>
          <span>★ {prompt.starCount}</span>
          {prompt.authorName && <span>by {prompt.authorName}</span>}
        </div>
      </div>
    </div>
  );
}

function CreatePromptForm({ onCreated, onError }: { onCreated: () => void; onError: (e: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'tenant' | 'public'>('private');
  const [model, setModel] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const authorName = getStoredUser()?.name ?? getStoredUser()?.email ?? undefined;

  const submit = async () => {
    if (!title.trim() || !body.trim()) { onError('Title and prompt body are required'); return; }
    setSaving(true);
    try {
      const payload: CreatePromptBody = {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        visibility,
        model: model.trim() || undefined,
        body,
        authorName,
      };
      await promptLibraryApi.create(payload);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create prompt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>New prompt</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        <input style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input style={input} placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input style={input} placeholder="Category (e.g. code-review)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input style={input} placeholder="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <select style={input} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
            <option value="private">Private (only me)</option>
            <option value="tenant">Team</option>
            <option value="public">Public (everyone)</option>
          </select>
          <input style={input} placeholder="Recommended model (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <textarea
          style={{ ...input, minHeight: 160, fontFamily: 'ui-monospace, monospace' }}
          placeholder={'Prompt body. Use {{variable}} placeholders.'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <button onClick={submit} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Create prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      background: active ? 'var(--accent, #2563eb)' : 'transparent',
      color: active ? '#fff' : 'var(--text-muted)',
      border: `1px solid ${active ? 'transparent' : 'var(--border-subtle)'}`,
    }}>{children}</button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-muted, rgba(255,255,255,0.05))', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
      {children}
    </span>
  );
}

const primaryBtn: React.CSSProperties = {
  fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'var(--accent, #2563eb)', color: '#fff', border: 'none',
};
const ghostBtn: React.CSSProperties = {
  fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
  background: 'transparent', color: 'inherit', border: '1px solid var(--border-subtle)',
};
