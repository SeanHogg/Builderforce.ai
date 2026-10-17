// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { clearConsoleEntries, matchesConsoleFilter, type ConsoleEntry, type ConsoleFilter, type ConsoleLevel } from '@/lib/previewConsole';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

const FILTERS: readonly ConsoleFilter[] = ['all', 'errors', 'warnings', 'info'];

/** Level colours from the theme's status tokens — dark and light alike. */
const LEVEL_COLOR: Record<ConsoleLevel, string> = {
  error: 'var(--error-text)',
  warn: 'var(--warning-text)',
  info: 'var(--info-text)',
  log: 'var(--text-primary)',
  debug: 'var(--text-muted)',
};

/** Within this many pixels of the end counts as "at the newest line". */
const STICK_SLACK_PX = 16;

/**
 * The preview's console: what the running app logged, newest last — the same record
 * the agent reads with `canvas_read_preview_console`. Follows new output unless the
 * person has scrolled up to read something.
 */
export function ConsolePanel({ projectId, entries }: { projectId: WorkspaceId; entries: ConsoleEntry[] }) {
  const t = useTranslations('builderPanels');
  const [filter, setFilter] = useState<ConsoleFilter>('all');
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickRef = useRef(true);
  const shown = entries.filter((entry) => matchesConsoleFilter(entry.level, filter));

  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [shown.length, entries]);

  const onScroll = () => {
    const list = listRef.current;
    if (list) stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_SLACK_PX;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 8px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <div role="group" aria-label={t('consoleFilter')} style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              style={{
                padding: '2px 8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: filter === id ? 'var(--bg-elevated)' : 'transparent',
                color: filter === id ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 'var(--font-size-small)', fontWeight: 600,
              }}
            >
              {t(`consoleLevel.${id}` as 'consoleLevel.all')}
            </button>
          ))}
        </div>
        <span role="status" style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
          {t('consoleEntries', { count: shown.length })}
        </span>
        <Button type="button" variant="ghost" size="sm" disabled={entries.length === 0} onClick={() => clearConsoleEntries(projectId)}>
          {t('consoleClear')}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p style={{ margin: 0, padding: 12, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
          {entries.length === 0 ? t('consoleEmpty') : t('consoleEmptyFiltered')}
        </p>
      ) : (
        <ol
          ref={listRef}
          onScroll={onScroll}
          aria-label={t('console')}
          style={{ listStyle: 'none', margin: 0, padding: '4px 0', overflow: 'auto', flex: 1, minHeight: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-small)' }}
        >
          {shown.map((entry) => (
            <li
              key={entry.id}
              data-level={entry.level}
              style={{
                display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 10px',
                color: LEVEL_COLOR[entry.level],
                background: entry.level === 'error' ? 'var(--error-bg)' : entry.level === 'warn' ? 'var(--warning-bg)' : 'transparent',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ flexShrink: 0, minWidth: 40, color: 'var(--text-muted)' }}>{entry.level}</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.text}</span>
              {entry.count > 1 && <span style={{ flexShrink: 0, color: 'var(--text-muted)' }}>×{entry.count}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
