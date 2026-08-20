'use client';

/**
 * PROJECT SPEND — what this project's AI work cost.
 *
 * The number existed and was unreachable. Per-project cost has been on every usage
 * row since 0103 and rolled up in `/api/dashboard/usage`, but the only place it
 * surfaced was inside an account-wide FinOps lens — so the question people actually
 * ask ("what has this board cost me") required leaving the project, opening a
 * different lens, and finding one row among every project, user, team and repo.
 *
 * BYO IS SHOWN SEPARATELY, and that is the point of the second line. A BYO row
 * records `cost_usd_millicents = 0` by design (the tenant's own provider account
 * paid for the tokens), so a project running mostly on a connected account reads as
 * costing nothing. Reporting its tokens alongside the dollar figure is the
 * difference between "this was free" and "this was paid for somewhere else".
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getProjectSpend, type ProjectSpend } from '@/lib/project360Api';

const WINDOWS: ReadonlyArray<ProjectSpend['window']> = ['today', 'week', 'month'];

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  background: active ? 'var(--surface-interactive)' : 'none',
  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
});

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

export function ProjectSpendWidget({ projectId }: { projectId: number }) {
  const t = useTranslations('projectSpend');
  const [window, setWindow] = useState<ProjectSpend['window']>('month');
  const [data, setData] = useState<ProjectSpend | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await getProjectSpend(projectId, window));
    } catch {
      // A spend read is informational — a failure hides the widget rather than
      // surfacing an error the reader can do nothing about on a health page.
      setError(true);
    }
  }, [projectId, window]);

  useEffect(() => { void load(); }, [load]);

  if (error) return null;

  return (
    <section style={cardStyle} aria-label={t('title')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('title')}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              style={tabStyle(w === window)}
              aria-pressed={w === window}
              onClick={() => setWindow(w)}
            >
              {t(`window.${w}`)}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>{t('loading')}</p>
      ) : data.requests === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>{t('empty')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                ${data.costUsd.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('cost')}</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{compact(data.totalTokens)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('tokens')}</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{compact(data.requests)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('requests')}</div>
            </div>
          </div>

          {data.byoTokens > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
              {t('byoNote', { tokens: compact(data.byoTokens) })}
            </p>
          )}

          {data.topModels.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.topModels.map((m) => (
                <li
                  key={m.model}
                  style={{ display: 'flex', gap: 10, justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.model}</span>
                  <span style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
                    ${m.costUsd.toFixed(2)} · {compact(m.totalTokens)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
