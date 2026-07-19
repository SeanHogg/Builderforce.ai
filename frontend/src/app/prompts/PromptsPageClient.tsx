'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import {
  promptLibraryApi,
  type PromptSummary,
  type PromptPublicView,
  type PromptEntry,
  type CreatePromptBody,
} from '@/lib/builderforceApi';
import { getStoredUser } from '@/lib/auth';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import { PromptVersionDiff } from '@/components/prompts/PromptVersionDiff';
import type { PromptAnalysis } from '@/lib/builderforceApi';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

type Tab = 'public' | 'mine';

export default function PromptsPage() {
  const t = useTranslations('promptsPage');
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
  const [viewMode, setViewMode] = useState<ViewMode>('card');

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

  // Refetch when the Brain creates/updates/deletes a prompt so this list stays
  // live instead of going stale until a manual reload (reloads the active tab).
  const reloadPrompts = useCallback(() => {
    tab === 'public' ? loadPublic(q) : loadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, sort]);
  useBrainDataRefresh(['prompts'], reloadPrompts);

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
    <div className="page-inner">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('title')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 600, margin: '0 auto' }}>
          {t('subtitle')}{isAuthed ? t('subtitleAuthed') : t('subtitleGuest')}
        </p>
        {isAuthed && (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? t('close') : t('newPrompt')}
            </button>
          </div>
        )}
      </div>

      {showCreate && isAuthed && (
        <CreatePromptForm
          onCreated={() => { setShowCreate(false); setTab('mine'); loadMine(); }}
          onError={setError}
        />
      )}

      {/* Tabs + view toggle */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" className={`btn ${tab === 'public' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('public')}>{t('tabPublic')}</button>
        {isAuthed && <button type="button" className={`btn ${tab === 'mine' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('mine')}>{t('tabMine')}</button>}
        <div style={{ marginLeft: 'auto' }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Search + sort (public gallery) */}
      {tab === 'public' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="search"
            className="input"
            style={{ maxWidth: 320 }}
            placeholder={t('searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadPublic(q); }}
          />
          <Select className="input" style={{ maxWidth: 150 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="popular">{t('sortPopular')}</option>
            <option value="recent">{t('sortRecent')}</option>
            <option value="featured">{t('sortFeatured')}</option>
          </Select>
        </div>
      )}

      {tab === 'public' && !loading && !error && (
        <CatalogInsightsBar
          entity="prompts"
          items={prompts.map((p): CatalogInsightsItem => ({ key: p.id, name: p.title, group: p.category ?? null, primary: p.usageCount, secondary: p.starCount }))}
          primaryMetric="usage"
          secondaryMetric="stars"
          groupKind="category"
          showTrend={isAuthed}
        />
      )}

      {loading && <div style={card}>{t('loading')}</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {!loading && !error && viewMode === 'card' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {prompts.map((p) => (
            <button key={p.id} onClick={() => openDetail(p)} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{p.title}</span>
                {p.isFeatured && <span title="Featured">⭐</span>}
              </div>
              {p.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {p.category && <span className="badge badge-gray">{p.category}</span>}
                {p.tags.slice(0, 3).map((tag) => <span key={tag} className="badge badge-gray">#{tag}</span>)}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>▶ {t('usesCount', { n: p.usageCount })}</span>
                <span>★ {p.starCount}</span>
                {p.authorName && <span>{t('byAuthor', { name: p.authorName })}</span>}
              </div>
            </button>
          ))}
          {prompts.length === 0 && (
            <div style={{ ...card, gridColumn: '1 / -1', color: 'var(--text-muted)' }}>
              {tab === 'mine' ? t('emptyMine') : t('emptyPublic')}
            </div>
          )}
        </div>
      )}

      {!loading && !error && viewMode === 'table' && (
        prompts.length === 0 ? (
          <div style={{ ...card, color: 'var(--text-muted)' }}>
            {tab === 'mine' ? t('emptyMine') : t('emptyPublic')}
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Uses</th>
                  <th style={thStyle}>Stars</th>
                  <th style={thStyle}>Author</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => (
                  <tr key={p.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {p.title}
                        {p.isFeatured && <span title="Featured">⭐</span>}
                      </span>
                    </td>
                    <td style={tdMutedStyle}>{p.category ?? '—'}</td>
                    <td style={tdMutedStyle}>{p.usageCount.toLocaleString()}</td>
                    <td style={tdMutedStyle}>{p.starCount}</td>
                    <td style={tdMutedStyle}>{p.authorName ?? '—'}</td>
                    <td style={tdStyle}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDetail(p)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
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
  const t = useTranslations('promptsPage');
  const [starred, setStarred] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [analysis, setAnalysis] = useState<PromptAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = (prompt as PromptPublicView & { id: string }).id;

  const toggleStar = async () => {
    try {
      if (starred) { await promptLibraryApi.unstar(id); setStarred(false); }
      else { await promptLibraryApi.star(id); setStarred(true); }
    } catch { /* ignore */ }
  };

  const runAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setSaved(false);
    try {
      setAnalysis(await promptLibraryApi.analyze(id));
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveSuggestion = async () => {
    if (!analysis?.suggestion) return;
    try {
      await promptLibraryApi.addVersion(id, { body: analysis.suggestion, notes: 'Analyzer suggestion' });
      setSaved(true);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Save failed');
    }
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
          {prompt.category && <span className="badge badge-gray">{prompt.category}</span>}
          {prompt.tags.map((t) => <span key={t} className="badge badge-gray">#{t}</span>)}
          {prompt.model && <span className="badge badge-gray">model: {prompt.model}</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={onUse}>Use this prompt (copy)</button>
          {isAuthed && id && <button type="button" className="btn btn-secondary" onClick={toggleStar}>{starred ? '★ Starred' : '☆ Star'}</button>}
          {isAuthed && id && <button type="button" className="btn btn-secondary" onClick={() => setShowHistory(true)}>{t('history')}</button>}
          {isAuthed && id && (
            <button type="button" className="btn btn-secondary" onClick={runAnalyze} disabled={analyzing}>
              {analyzing ? t('analyzing') : t('analyze')}
            </button>
          )}
        </div>

        {analyzeError && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 13, marginBottom: 12 }}>{analyzeError}</div>}

        {analysis && (
          <div style={{ ...card, marginBottom: 16, borderColor: 'var(--coral-bright, #f4726e)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('suggestionTitle')}</div>
            {analysis.rationale && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>{analysis.rationale}</p>}
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, fontFamily: 'ui-monospace, monospace', maxHeight: 280, overflowY: 'auto', margin: 0 }}>{analysis.suggestion}</pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveSuggestion} disabled={saved}>
                {saved ? t('savedVersion') : t('saveAsVersion')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(analysis.suggestion).catch(() => {})}>{t('copySuggestion')}</button>
            </div>
          </div>
        )}

        {showHistory && id && <PromptVersionDiff promptId={id} open={showHistory} onClose={() => setShowHistory(false)} />}

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
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder="Short description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input className="input" placeholder="Category (e.g. code-review)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="input" placeholder="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
            <option value="private">Private (only me)</option>
            <option value="tenant">Team</option>
            <option value="public">Public (everyone)</option>
          </Select>
          <input className="input" placeholder="Recommended model (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <textarea
          className="input"
          style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace' }}
          placeholder={'Prompt body. Use {{variable}} placeholders.'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Create prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}
