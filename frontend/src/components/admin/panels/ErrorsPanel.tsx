'use client';

import { Icon } from '@/components/ui/Icon';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminError as AdminErrorEntry,
  type AdminErrorFilters,
  type AdminErrorPage,
} from '@/lib/adminApi';
import { AdminError, AdminLoading, errText, fmtDateTime } from '@/components/admin/adminShared';

const PAGE_SIZE = 50;

/** Retention windows offered by the window filter, in hours. */
const WINDOWS = [1, 24, 168, 720] as const;
type Window = (typeof WINDOWS)[number] | 0;

const WINDOW_KEY: Record<number, string> = { 0: 'all', 1: 'h1', 24: 'h24', 168: 'd7', 720: 'd30' };

type HandledFilter = 'all' | 'unhandled' | 'handled';

/** Compact stat tile — the answer, above the evidence. */
function Tile({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 120,
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: tone === 'danger' && value > 0 ? 'var(--danger)' : 'var(--text-primary)',
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export default function ErrorsPanel() {
  const t = useTranslations('admin');

  const [page, setPage] = useState<AdminErrorPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [windowHours, setWindowHours] = useState<Window>(24);
  const [handled, setHandled] = useState<HandledFilter>('all');
  const [source, setSource] = useState('');
  const [operation, setOperation] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);

  const filters = useMemo<AdminErrorFilters>(
    () => ({
      sinceHours: windowHours || undefined,
      handled: handled === 'all' ? undefined : handled === 'handled',
      source: source || undefined,
      operation: operation || undefined,
      q: applied || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [windowHours, handled, source, operation, applied, offset],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi
      .errors(filters)
      .then(setPage)
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { reload(); }, [reload]);

  // Any filter change invalidates the current page position.
  const resetTo = useCallback((apply: () => void) => { apply(); setOffset(0); setExpandedId(null); }, []);

  if (loading && !page) return <AdminLoading />;

  const rows = page?.errors ?? [];
  const summary = page?.summary;
  const total = page?.total ?? 0;
  const activeFault = source || operation;

  return (
    <div>
      <AdminError message={error} />

      {/* ---- Answer: how much is broken, and what is loudest ---- */}
      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Tile label={t('errors.statTotal')} value={summary.total} />
          <Tile label={t('errors.statUnhandled')} value={summary.unhandled} tone="danger" />
          <Tile label={t('errors.statHandled')} value={summary.handled} />
          <Tile label={t('errors.statFaults')} value={summary.distinctFaults} />
        </div>
      )}

      {/* ---- Filters ---- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select
          className="admin-select"
          value={String(windowHours)}
          onChange={(e) => resetTo(() => setWindowHours(Number(e.target.value) as Window))}
          aria-label={t('errors.window')}
        >
          {[0, ...WINDOWS].map((h) => (
            <option key={h} value={h} style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>
              {t(`errors.window_${WINDOW_KEY[h]}`)}
            </option>
          ))}
        </select>

        <select
          className="admin-select"
          value={handled}
          onChange={(e) => resetTo(() => setHandled(e.target.value as HandledFilter))}
          aria-label={t('errors.handledFilter')}
        >
          {(['all', 'unhandled', 'handled'] as const).map((v) => (
            <option key={v} value={v} style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>
              {t(`errors.handled_${v}`)}
            </option>
          ))}
        </select>

        <select
          className="admin-select"
          value={source}
          onChange={(e) => resetTo(() => { setSource(e.target.value); setOperation(''); })}
          aria-label={t('errors.sourceFilter')}
          style={{ maxWidth: 280 }}
        >
          <option value="" style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>
            {t('errors.allSources')}
          </option>
          {(page?.sources ?? []).map((s) => (
            <option key={s} value={s} style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>{s}</option>
          ))}
        </select>

        <input
          className="admin-select"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') resetTo(() => setApplied(search)); }}
          placeholder={t('errors.searchPlaceholder')}
          style={{ flex: '1 1 200px', minWidth: 160 }}
        />
        <button type="button" className="admin-tab" onClick={() => resetTo(() => setApplied(search))}>
          {t('common.filter')}
        </button>
        {activeFault && (
          <button type="button" className="admin-tab" onClick={() => resetTo(() => { setSource(''); setOperation(''); })}>
            {t('errors.clearFault')}
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={reload}>↻ {t('common.refresh')}</button>
      </div>

      {/* ---- Loudest faults: click to scope the rows below ---- */}
      {summary && summary.groups.length > 0 && !activeFault && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--text-primary)' }}>{t('errors.topFaults')}</h3>
          <div className="table-wrap">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>{t('errors.source')}</th>
                  <th>{t('errors.operation')}</th>
                  <th style={{ textAlign: 'right' }}>{t('errors.count')}</th>
                  <th style={{ textAlign: 'right' }}>{t('errors.statUnhandled')}</th>
                  <th style={{ textAlign: 'right' }}>{t('errors.tenants')}</th>
                  <th>{t('errors.lastSeen')}</th>
                  <th>{t('errors.sample')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.groups.slice(0, 10).map((g) => (
                  <tr
                    key={`${g.source}|${g.operation}`}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => resetTo(() => { setSource(g.source ?? ''); setOperation(g.operation ?? ''); })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        resetTo(() => { setSource(g.source ?? ''); setOperation(g.operation ?? ''); });
                      }
                    }}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' }}>{g.source ?? '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{g.operation ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{g.count.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: g.unhandledCount > 0 ? 'var(--danger)' : undefined }}>
                      {g.unhandledCount.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>{g.tenantCount}</td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(g.lastSeen)}</td>
                    <td
                      style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
                      title={g.sampleMessage ?? undefined}
                    >
                      {g.sampleMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeFault && (
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {t('errors.scopedTo', { source: source || '—', operation: operation || '—' })}
        </p>
      )}

      {/* ---- Evidence ---- */}
      {rows.length === 0 ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('errors.noErrorsRecorded')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>{t('errors.time')}</th>
                  <th>{t('errors.kind')}</th>
                  <th>{t('errors.source')}</th>
                  <th>{t('errors.path')}</th>
                  <th>{t('errors.tenant')}</th>
                  <th>{t('errors.message')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e: AdminErrorEntry) => {
                  const open = expandedId === e.id;
                  const toggle = () => setExpandedId(open ? null : e.id);
                  const hasDetail = Boolean(e.stack) || Object.keys(e.context ?? {}).length > 0;
                  return (
                    <React.Fragment key={e.id}>
                      <tr
                        role="button"
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}
                        style={{ cursor: 'pointer' }}
                      >
                        <td style={{ verticalAlign: 'middle' }}>
                          {hasDetail && (
                            <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}><Icon source="▶" size="1em" /></span>
                          )}
                        </td>
                        <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '1px 7px',
                              borderRadius: 'var(--radius-full)',
                              fontSize: 11,
                              fontWeight: 600,
                              border: '1px solid var(--border)',
                              color: e.handled ? 'var(--text-muted)' : 'var(--danger)',
                            }}
                          >
                            {e.handled ? t('errors.handled_handled') : t('errors.handled_unhandled')}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 240, wordBreak: 'break-all' }}>
                          {e.source ? `${e.source}${e.operation ? ` · ${e.operation}` : ''}` : '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 200, wordBreak: 'break-all' }}>
                          {e.method ? `${e.method} ` : ''}{e.path ?? '—'}
                        </td>
                        <td className="text-muted">{e.tenantId ?? '—'}</td>
                        <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.message ?? undefined}>
                          {e.message ?? '—'}
                        </td>
                      </tr>
                      {open && hasDetail && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, verticalAlign: 'top' }}>
                            <div style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', padding: 12 }}>
                              {Object.keys(e.context ?? {}).length > 0 && (
                                <>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                                    {t('errors.context')}
                                  </div>
                                  <pre style={{ margin: '0 0 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {JSON.stringify(e.context, null, 2)}
                                  </pre>
                                </>
                              )}
                              {e.stack && (
                                <>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                                    {t('errors.stack')}
                                  </div>
                                  <pre style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                    {e.stack}
                                  </pre>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="admin-tab" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                {t('common.prev')}
              </button>
              <span style={{ fontSize: 13 }}>
                {t('errors.pagination', { from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
              </span>
              <button type="button" className="admin-tab" disabled={!page?.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
