'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Unified shape for a revocable session, satisfied by both the current user's
 * own sessions (`MySession`) and a workspace member's sessions
 * (`SecuritySession`). Kept here so the one list UI serves every caller.
 */
export interface ManagedSession {
  id: string;
  sessionName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  isActive: boolean;
  /** The viewer's own current session — never selectable/revocable. */
  isCurrent?: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

const PAGE_SIZE = 8;

interface SessionListProps {
  sessions: ManagedSession[];
  /** Revoke the given session ids (bulk-capable). Parent updates state on success. */
  onRevoke: (ids: string[]) => Promise<void>;
}

/**
 * One reusable sessions list with multi-select (per-row + select-all), a single
 * group "sign out selected" action, and pagination. Replaces the prior
 * one-by-one-only revoke UIs on both Settings and Security so neither drifts.
 */
export function SessionList({ sessions, onRevoke }: SessionListProps) {
  const t = useTranslations('security');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  const revocable = useMemo(() => sessions.filter((s) => s.isActive && !s.isCurrent), [sessions]);
  const pageCount = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = sessions.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const selectedCount = selected.size;
  const allSelected = revocable.length > 0 && revocable.every((s) => selected.has(s.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(revocable.map((s) => s.id)));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const revoke = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    if (ids.length > 1 && !confirm(t('confirmRevokeSelected', { count: ids.length }))) return;
    setBusy(true);
    try {
      await onRevoke(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  if (sessions.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noSessions')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Select-all + group action header */}
      {revocable.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label={t('selectAll')}
              style={{ width: 15, height: 15, accentColor: 'var(--coral-bright, #f4726e)', cursor: 'pointer' }}
            />
            {selectedCount > 0 ? t('selected', { count: selectedCount }) : t('selectAll')}
          </label>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => void revoke([...selected])}
              disabled={busy}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600,
                background: 'var(--coral-bright, #f4726e)', color: '#fff',
                border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? '…' : t('revokeSelected', { count: selectedCount })}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pageItems.map((s) => {
          const isRevocable = s.isActive && !s.isCurrent;
          const isSelected = selected.has(s.id);
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--bg-elevated)',
              border: `1px solid ${s.isCurrent ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}`,
              opacity: s.isActive ? 1 : 0.45,
            }}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleOne(s.id)}
                disabled={!isRevocable}
                aria-label={s.sessionName ?? s.userAgent ?? t('session')}
                style={{
                  width: 15, height: 15, flexShrink: 0,
                  accentColor: 'var(--coral-bright, #f4726e)',
                  cursor: isRevocable ? 'pointer' : 'not-allowed',
                  visibility: isRevocable ? 'visible' : 'hidden',
                }}
              />
              <div
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: s.isActive ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  {s.sessionName ?? s.userAgent ?? t('session')}
                  {s.isCurrent && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--surface-coral-soft, rgba(244,114,94,0.15))', color: 'var(--coral-bright, #f4726e)' }}>
                      {t('current')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {s.ipAddress && `${s.ipAddress} · `}
                  {s.lastSeenAt
                    ? t('lastActive', { time: new Date(s.lastSeenAt).toLocaleString() })
                    : t('created', { time: new Date(s.createdAt).toLocaleString() })}
                  {!s.isActive && s.revokedAt && ` · ${t('revoked')}`}
                </div>
              </div>
              {isRevocable && (
                <button
                  type="button"
                  onClick={() => void revoke([s.id])}
                  disabled={busy}
                  style={{
                    padding: '4px 8px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                    background: 'none', color: 'var(--coral-bright, #f4726e)',
                    border: '1px solid var(--coral-bright, #f4726e)', borderRadius: 6,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  {t('revoke')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{
              padding: '4px 10px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
              cursor: safePage === 0 ? 'default' : 'pointer', opacity: safePage === 0 ? 0.5 : 1,
            }}
          >
            {t('prev')}
          </button>
          <span>{t('pageOf', { page: safePage + 1, pages: pageCount })}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            style={{
              padding: '4px 10px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6,
              cursor: safePage >= pageCount - 1 ? 'default' : 'pointer', opacity: safePage >= pageCount - 1 ? 0.5 : 1,
            }}
          >
            {t('next')}
          </button>
        </div>
      )}
    </div>
  );
}
