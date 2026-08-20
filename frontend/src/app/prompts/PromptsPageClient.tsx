'use client';

import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/Select';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { type ViewMode } from '@/components/ViewToggle';
import { CatalogToolbar } from '@/components/CatalogToolbar';
import { FilterChips, type FilterChip } from '@/components/FilterChips';
import { Pagination } from '@/components/Pagination';
import { CatalogInsightsBar, type CatalogInsightsItem } from '@/components/CatalogInsightsBar';
import { PromptVersionDiff } from '@/components/prompts/PromptVersionDiff';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import type { PromptAnalysis } from '@/lib/builderforceApi';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { useFormat } from "@/i18n/useFormat";

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

type Tab = 'public' | 'mine';

/** Prompts per page. Matches the marketplace's grid so the two pages page alike. */
const PAGE_SIZE = 12;

export default function PromptsPage() {
  const fmt = useFormat();
  const t = useTranslations('promptsPage');
  const tCommon = useTranslations('common');
  const isAuthed = !!getStoredUser();
  const [tab, setTab] = useState<Tab>('public');
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popular' | 'recent' | 'featured'>('popular');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
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

  // Categories are DERIVED from the loaded corpus, never declared: the field is
  // free text on the create form, so a hand-kept list would be wrong the first
  // time somebody publishes a prompt under a category nobody thought of.
  const categoryChips: FilterChip[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prompts) {
      const key = p.category?.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { id: '', label: t('allCategories'), count: prompts.length },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id, count]) => ({ id, label: id, count })),
    ];
  }, [prompts, t]);

  const results = useMemo(
    () => (category ? prompts.filter((p) => p.category?.trim() === category) : prompts),
    [prompts, category],
  );

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = results.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Any narrowing returns to page 1 — otherwise a filter applied from page 4
  // lands on an empty grid.
  useEffect(() => { setPage(1); }, [category, tab, sort]);

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
      // Shared write; a refused clipboard resolves false rather than throwing, so the
      // usage-count update below still runs exactly as it did with the old `.catch(() => {})`.
      await copyTextToClipboard(fresh.body);
      setToast(tCommon('copied'));
      setSelected(fresh);
      setPrompts((prev) => prev.map((x) => (x.slug === p.slug ? { ...x, usageCount: fresh.usageCount } : x)));
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(e instanceof Error ? e.message : t('useFailed'));
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    // `/prompts` is a public page, so it takes THE marketing column (globals.css)
    // rather than the app shell's narrower `.page-inner` cap.
    <div className="mkt-in mkt-page">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{t('title')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)', maxWidth: 600, margin: '0 auto' }}>
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

      {/* Tabs — WHOSE prompts, above the controls that browse them. */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" className={`btn ${tab === 'public' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('public')}>{t('tabPublic')}</button>
        {isAuthed && <button type="button" className={`btn ${tab === 'mine' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('mine')}>{t('tabMine')}</button>}
      </div>

      {!loading && !error && (
        <CatalogInsightsBar
          entity="prompts"
          items={prompts.map((p): CatalogInsightsItem => ({ key: p.id, name: p.title, group: p.category ?? null, primary: p.usageCount, secondary: p.starCount }))}
          primaryMetric="usage"
          secondaryMetric="stars"
          groupKind="category"
          showTrend={isAuthed && tab === 'public'}
        />
      )}

      {!loading && !error && (
        <div style={{ marginBottom: 12 }}>
          <FilterChips chips={categoryChips} value={category} onChange={setCategory} ariaLabel={t('categoryLabel')} />
        </div>
      )}

      {/* Search + sort + count + view — the same bar the marketplace and the blog
          carry, so the three catalogues browse identically. */}
      <CatalogToolbar
        search={q}
        onSearch={setQ}
        onSubmit={() => { if (tab === 'public') loadPublic(q); }}
        searchPlaceholder={t('searchPlaceholder')}
        view={viewMode}
        onView={setViewMode}
        resultCount={loading ? undefined : results.length}
      >
        {tab === 'public' && (
          <Select
            className="input"
            style={{ maxWidth: 160 }}
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label={t('sortLabel')}
          >
            <option value="popular">{t('sortPopular')}</option>
            <option value="recent">{t('sortRecent')}</option>
            <option value="featured">{t('sortFeatured')}</option>
          </Select>
        )}
      </CatalogToolbar>

      {loading && <div style={card}>{t('loading')}</div>}
      {error && <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}

      {!loading && !error && viewMode === 'card' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {visible.map((p) => (
            <button key={p.id} onClick={() => openDetail(p)} style={{ ...card, textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-body)' }}>{p.title}</span>
                {p.isFeatured && <span title={t('featured')}><Icon source="⭐" size="1em" /></span>}
              </div>
              {p.description && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 10px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {p.category && <span className="badge badge-gray">{p.category}</span>}
                {p.tags.slice(0, 3).map((tag) => <span key={tag} className="badge badge-gray">#{tag}</span>)}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                <span><Icon source="▶" size="1em" /> {t('usesCount', { n: p.usageCount })}</span>
                <span><Icon source="★" size="1em" /> {p.starCount}</span>
                {p.authorName && <span>{t('byAuthor', { name: p.authorName })}</span>}
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ ...card, gridColumn: '1 / -1', color: 'var(--text-muted)' }}>
              {tab === 'mine' ? t('emptyMine') : t('emptyPublic')}
            </div>
          )}
        </div>
      )}

      {!loading && !error && viewMode === 'table' && (
        results.length === 0 ? (
          <div style={{ ...card, color: 'var(--text-muted)' }}>
            {tab === 'mine' ? t('emptyMine') : t('emptyPublic')}
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('colTitle')}</th>
                  <th style={thStyle}>{t('colCategory')}</th>
                  <th style={thStyle}>{t('colUses')}</th>
                  <th style={thStyle}>{t('colStars')}</th>
                  <th style={thStyle}>{t('colAuthor')}</th>
                  <th style={thStyle}>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} style={trStyle}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {p.title}
                        {p.isFeatured && <span title={t('featured')}><Icon source="⭐" size="1em" /></span>}
                      </span>
                    </td>
                    <td style={tdMutedStyle}>{p.category ?? '—'}</td>
                    <td style={tdMutedStyle}>{fmt.number(p.usageCount)}</td>
                    <td style={tdMutedStyle}>{p.starCount}</td>
                    <td style={tdMutedStyle}>{p.authorName ?? '—'}</td>
                    <td style={tdStyle}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openDetail(p)}>{tCommon('view')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {!loading && !error && <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} />}

      {selected && (
        <PromptDetail
          prompt={selected}
          isAuthed={isAuthed}
          onClose={() => setSelected(null)}
          onUse={() => applyPrompt(selected)}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', padding: '10px 18px', borderRadius: 'var(--radius-full)', fontSize: 'var(--font-size-small)', boxShadow: '0 6px 24px rgba(0,0,0,0.3)', zIndex: 100 }}>
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
      setAnalyzeError(e instanceof Error ? e.message : t('analysisFailed'));
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
      setAnalyzeError(e instanceof Error ? e.message : t('saveFailed'));
    }
  };

  return (
    // The canonical drawer, not a hand-rolled one: this panel used to declare its
    // own scrim, its own 560px box and its own `×`, which is how it shipped
    // without Esc, without a portal (so it stacked under the marketing header)
    // and without the reader's width control.
    <SlideOutPanel
      open
      onClose={onClose}
      title={prompt.title}
      crumb={t('title')}
      width="sheet"
      widthStorageKey="prompts"
    >
      <div style={{ padding: 24 }}>
        {prompt.description && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', marginTop: 0 }}>{prompt.description}</p>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 16px' }}>
          {prompt.category && <span className="badge badge-gray">{prompt.category}</span>}
          {prompt.tags.map((t) => <span key={t} className="badge badge-gray">#{t}</span>)}
          {prompt.model && <span className="badge badge-gray">{t('modelBadge', { model: prompt.model })}</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={onUse}>{t('usePromptCopy')}</button>
          {isAuthed && id && <button type="button" className="btn btn-secondary" onClick={toggleStar}>{starred ? t('starred') : t('star')}</button>}
          {isAuthed && id && <button type="button" className="btn btn-secondary" onClick={() => setShowHistory(true)}>{t('history')}</button>}
          {isAuthed && id && (
            <button type="button" className="btn btn-secondary" onClick={runAnalyze} disabled={analyzing}>
              {analyzing ? t('analyzing') : t('analyze')}
            </button>
          )}
        </div>

        {analyzeError && <div style={{ color: 'var(--danger)', fontSize: 'var(--font-size-small)', marginBottom: 12 }}>{analyzeError}</div>}

        {analysis && (
          <div style={{ ...card, marginBottom: 16, borderColor: 'var(--coral-bright)' }}>
            <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('suggestionTitle')}</div>
            {analysis.rationale && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 10px' }}>{analysis.rationale}</p>}
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-size-small)', fontFamily: 'ui-monospace, monospace', maxHeight: 280, overflowY: 'auto', margin: 0 }}>{analysis.suggestion}</pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={saveSuggestion} disabled={saved}>
                {saved ? t('savedVersion') : t('saveAsVersion')}
              </button>
              {/* Fire-and-forget as before — no confirmation state on this button. */}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void copyTextToClipboard(analysis.suggestion); }}>{t('copySuggestion')}</button>
            </div>
          </div>
        )}

        {showHistory && id && <PromptVersionDiff promptId={id} open={showHistory} onClose={() => setShowHistory(false)} />}

        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 6 }}>{t('promptVersionLabel', { v: prompt.currentVersion })}</div>
        <pre style={{ ...card, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-size-small)', fontFamily: 'ui-monospace, monospace', maxHeight: 360, overflowY: 'auto' }}>{prompt.body}</pre>

        {prompt.variables.length > 0 && (
          <>
            <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '16px 0 6px' }}>{t('variablesLabel')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {prompt.variables.map((v) => (
                <div key={v.name} style={{ ...card, padding: 10, fontSize: 'var(--font-size-small)' }}>
                  <code style={{ fontWeight: 700 }}>{`{{${v.name}}}`}</code>
                  {v.description && <span style={{ color: 'var(--text-muted)' }}> — {v.description}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 16, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 16 }}>
          <span><Icon source="▶" size="1em" /> {t('usesCount', { n: prompt.usageCount })}</span>
          <span><Icon source="★" size="1em" /> {prompt.starCount}</span>
          {prompt.authorName && <span>{t('byAuthor', { name: prompt.authorName })}</span>}
        </div>
      </div>
    </SlideOutPanel>
  );
}

function CreatePromptForm({ onCreated, onError }: { onCreated: () => void; onError: (e: string) => void }) {
  const t = useTranslations('promptsPage');
  const tCommon = useTranslations('common');
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
    if (!title.trim() || !body.trim()) { onError(t('createValidation')); return; }
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
      onError(e instanceof Error ? e.message : t('createFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, marginBottom: 20 }}>
      <h2 style={{ fontSize: 'var(--font-size-body)', fontWeight: 600, margin: '0 0 12px' }}>{t('createTitle')}</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        <input className="input" placeholder={t('phTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder={t('phDescription')} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input className="input" placeholder={t('phCategory')} value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="input" placeholder={t('phTags')} value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
            <option value="private">{t('visPrivate')}</option>
            <option value="tenant">{t('visTenant')}</option>
            <option value="public">{t('visPublic')}</option>
          </Select>
          <input className="input" placeholder={t('phModel')} value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        {/* The `{{variable}}` token is passed as an ICU argument so the braces never
            have to be escaped inside the message catalogs. */}
        <textarea
          className="input"
          style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace' }}
          placeholder={t('phBody', { ph: '{{variable}}' })}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? tCommon('saving') : t('createSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}
