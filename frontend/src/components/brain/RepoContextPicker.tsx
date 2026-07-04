'use client';

/**
 * Repo file picker for the Brain composer's "Add context" affordance. When the
 * active chat's project has one or more connected repositories, the user can
 * pick a file from the repo and attach its content as context for the next turn.
 *
 * The file manifest comes from the SAME server-side, token-scoped endpoint the
 * IDE uses to hydrate its workspace (`reposApi.contents`), so the token never
 * reaches the browser. That endpoint returns every file WITH content in one
 * shot (and is metered as ingestion), so we cache the manifest per repo for the
 * lifetime of this picker — switching repos back and forth never re-pulls.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { reposApi, type ProjectRepository, type ImportedRepoFile } from '@/lib/builderforceApi';

const MAX_ROWS = 300;

export function RepoContextPicker({ repos, onPick, onClose }: {
  repos: ProjectRepository[];
  /** Attach the chosen file (relative path + text content) as message context. */
  onPick: (path: string, content: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('repoContext');
  const [repoId, setRepoId] = useState(repos.find((r) => r.isDefault)?.id ?? repos[0]?.id ?? '');
  const [files, setFiles] = useState<ImportedRepoFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [attaching, setAttaching] = useState(false);
  // Session cache: repoId → manifest files, so re-selecting a repo is free.
  const cacheRef = useRef<Record<string, ImportedRepoFile[]>>({});

  useEffect(() => {
    if (!repoId) return;
    const cached = cacheRef.current[repoId];
    if (cached) { setFiles(cached); setError(''); setLoading(false); return; }
    let live = true;
    setLoading(true); setError(''); setFiles(null);
    reposApi.contents(repoId)
      .then((m) => { if (!live) return; const list = m.files ?? []; cacheRef.current[repoId] = list; setFiles(list); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : t('error')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [repoId, t]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const list = files ?? [];
    const q = query.trim().toLowerCase();
    const base = q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
    return base.slice(0, MAX_ROWS);
  }, [files, query]);

  const total = files?.length ?? 0;
  const hidden = Math.max(0, (query.trim() ? (files ?? []).filter((f) => f.path.toLowerCase().includes(query.trim().toLowerCase())).length : total) - filtered.length);

  const pick = async (f: ImportedRepoFile) => {
    if (attaching) return;
    setAttaching(true);
    try { await onPick(f.path, f.content); } finally { setAttaching(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: 'min(70vh, 640px)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-base)', color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)', borderRadius: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t('title')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          {repos.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('repo')}
              <select
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                style={{ padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>{r.owner}/{r.repo}{r.isDefault ? ` (${t('default')})` : ''}</option>
                ))}
              </select>
            </label>
          )}
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
          {loading && <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>{t('loading')}</div>}
          {!loading && error && (
            <div role="alert" style={{ margin: 8, padding: '8px 10px', fontSize: 13, borderRadius: 8, background: 'var(--error-bg)', color: 'var(--error-text)' }}>{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>{t('empty')}</div>
          )}
          {!loading && !error && filtered.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => pick(f)}
              disabled={attaching}
              title={f.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 9px', border: 'none', borderRadius: 8, background: 'transparent',
                color: 'var(--text-primary)', fontSize: 13, textAlign: 'left',
                cursor: attaching ? 'wait' : 'pointer', fontFamily: 'var(--font-mono, monospace)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span aria-hidden style={{ flexShrink: 0 }}>📄</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
            </button>
          ))}
          {!loading && !error && hidden > 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>{t('more', { count: hidden })}</div>
          )}
        </div>
      </div>
    </div>
  );
}
