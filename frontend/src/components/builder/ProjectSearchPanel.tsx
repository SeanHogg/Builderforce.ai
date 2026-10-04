// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectSearchMatch } from '@/lib/api';
import type { WorkspaceFileStore } from '@/lib/workspace/workspaceFileStore';
import { faultMessage } from '@/lib/apiClient';
import { requestEditorReveal } from '@/lib/workspace/editorReveal';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

/**
 * Search every file in the project and jump to a hit. Results are grouped by
 * file; choosing one opens the file at that line.
 */
export function ProjectSearchPanel({ store, onOpenFile }: { store: WorkspaceFileStore; onOpenFile: (path: string) => void }) {
  const t = useTranslations('builderSearch');
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ProjectSearchMatch[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMatches(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      store.search(trimmed)
        .then((result) => {
          if (cancelled) return;
          setMatches(result.matches);
          setTruncated(result.truncated);
          setError(null);
        })
        .catch((cause: unknown) => { if (!cancelled) setError(faultMessage(cause, t('failed'))); })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, store, t]);

  const byFile = useMemo(() => {
    const groups = new Map<string, ProjectSearchMatch[]>();
    for (const match of matches ?? []) groups.set(match.path, [...(groups.get(match.path) ?? []), match]);
    return [...groups.entries()];
  }, [matches]);

  const open = (match: ProjectSearchMatch) => {
    requestEditorReveal(match.path, match.line);
    onOpenFile(match.path);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
        <label htmlFor={inputId} className="sr-only">{t('label')}</label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          className="ui-input"
          style={{ width: '100%' }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div role="status" aria-live="polite" style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
        {busy ? t('searching')
          : error ? <span style={{ color: 'var(--error-text)' }}>{error}</span>
            : matches === null ? t('hint', { min: MIN_QUERY })
              : t(truncated ? 'countTruncated' : 'count', { matches: matches.length, files: byFile.length })}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {byFile.map(([path, hits]) => (
          <li key={path} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ padding: '6px 10px', fontWeight: 600, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{path}</div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {hits.map((hit) => (
                <li key={`${hit.line}:${hit.column}`}>
                  <button
                    type="button"
                    onClick={() => open(hit)}
                    style={{ display: 'flex', gap: 8, width: '100%', minHeight: 32, padding: '4px 10px 4px 18px', border: 0, background: 'none', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-small)' }}
                  >
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{hit.line}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
