'use client';

/**
 * Repo file picker for the Brain composer's "Add context" affordance. When the
 * active chat is in a repo-backed context, the user can pick a file and attach
 * its content as context for the next turn.
 *
 * Sources are pluggable so the picker stays DRY across contexts:
 *   • a connected project repository (default branch), and
 *   • the AGENT WORKING BRANCH (the ticket branch a live/finished run commits to)
 *     when the chat is tied to a task — so "chatting with the agent" can reference
 *     the file the agent is actually editing, not just the default branch.
 *
 * Each source loads its manifest server-side (the git token never reaches the
 * browser). Manifests are cached per source for the picker's lifetime, so
 * switching sources back and forth never re-pulls.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import type { ImportedRepoFile } from '@/lib/builderforceApi';

const MAX_ROWS = 300;

/** A place the picker can list files from (a connected repo, or a ticket branch). */
export interface RepoFileSource {
  id: string;
  label: string;
  load: () => Promise<ImportedRepoFile[]>;
}

export function RepoContextPicker({ sources, onPick, onClose }: {
  sources: RepoFileSource[];
  /** Attach the chosen file (relative path + text content) as message context. */
  onPick: (path: string, content: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('repoContext');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [files, setFiles] = useState<ImportedRepoFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [attaching, setAttaching] = useState(false);
  // Session cache: sourceId → manifest files, so re-selecting a source is free.
  const cacheRef = useRef<Record<string, ImportedRepoFile[]>>({});

  const source = useMemo(() => sources.find((s) => s.id === sourceId) ?? sources[0], [sources, sourceId]);

  useEffect(() => {
    if (!source) return;
    const cached = cacheRef.current[source.id];
    if (cached) { setFiles(cached); setError(''); setLoading(false); return; }
    let live = true;
    setLoading(true); setError(''); setFiles(null);
    source.load()
      .then((list) => { if (!live) return; cacheRef.current[source.id] = list; setFiles(list); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : t('error')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [source, t]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const list = files ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
  }, [files, query]);
  const filtered = matches.slice(0, MAX_ROWS);
  const hidden = Math.max(0, matches.length - filtered.length);

  const pick = async (f: ImportedRepoFile) => {
    if (attaching) return;
    setAttaching(true);
    try { await onPick(f.path, f.content); } finally { setAttaching(false); }
  };

  return (
    <SlideOutPanel open onClose={onClose} title={t('title')} width="min(560px, 96vw)">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {sources.length > 1 && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('source')}
              <select
                value={source?.id ?? ''}
                onChange={(e) => setSourceId(e.target.value)}
                style={{ padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
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
    </SlideOutPanel>
  );
}
