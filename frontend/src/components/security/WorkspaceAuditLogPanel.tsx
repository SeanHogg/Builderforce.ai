/**
 * Workspace audit log — the tenant-scoped event trail (`GET /api/audit/events`).
 *
 * The superadmin console has had a platform-wide audit panel for a long time; the
 * WORKSPACE view of the same trail — the one a manager shows an auditor, or reads to
 * answer "who moved this ticket" — had a typed client (`auditApi`) and no surface.
 * This is that surface, under Security beside the SOC 2 evidence it feeds.
 *
 * Self-contained: it owns its filters, its paging and its export, reads through the
 * typed client only, and gates itself on the compliance capability (the route is
 * manager + `audit:read`), so it can be dropped onto a second surface unchanged.
 * No `'use client'` of its own: it is mounted from client components (Security is
 * one), which already puts it on the client side of the boundary.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { auditApi, type AuditEvent } from '@/lib/builderforceApi';
import { usePanelTask } from '@/hooks/usePanelTask';
import { downloadText } from '@/lib/download';
import { RoleGate } from '@/components/RoleGate';
import { useFormat } from '@/i18n/useFormat';

const PAGE_SIZE = 50;

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 'var(--font-size-small)',
  outline: 'none', minWidth: 0, flex: '1 1 180px',
};
const btn = (variant: 'primary' | 'ghost'): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-small)',
  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  border: variant === 'primary' ? 'none' : '1px solid var(--border-subtle)',
  background: variant === 'primary' ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-elevated)',
  color: variant === 'primary' ? 'var(--text-on-accent)' : 'var(--text-primary)',
});
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 'var(--font-size-eyebrow)', letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top',
};

/** One CSV line, RFC 4180 quoting — a metadata blob with commas or quotes stays one cell. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function WorkspaceAuditLogPanel() {
  const t = useTranslations('security');
  const fmt = useFormat();
  const { run, busy, error } = usePanelTask();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [eventTypeDraft, setEventTypeDraft] = useState('');
  const [resourceTypeDraft, setResourceTypeDraft] = useState('');
  const [filters, setFilters] = useState<{ eventType?: string; resourceType?: string }>({});

  const load = useCallback(async () => {
    const rows = await run(
      () => auditApi.list({ limit: PAGE_SIZE, offset, ...filters }),
      { failure: t('auditLog.loadFailed') },
    );
    if (rows) setEvents(rows);
  }, [offset, filters, run, t]);

  // Kicked off from a microtask rather than the effect body: `run` flips `busy`
  // synchronously, and a synchronous setState inside an effect is the cascading-render
  // pattern the hooks ratchet forbids. `alive` drops a load whose panel unmounted first.
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => { if (alive) void load(); });
    return () => { alive = false; };
  }, [load]);

  const applyFilters = () => {
    setOffset(0);
    setFilters({
      ...(eventTypeDraft.trim() ? { eventType: eventTypeDraft.trim() } : {}),
      ...(resourceTypeDraft.trim() ? { resourceType: resourceTypeDraft.trim() } : {}),
    });
  };

  const exportCsv = () => {
    const header = ['id', 'createdAt', 'eventType', 'userId', 'resourceType', 'resourceId', 'metadata'];
    const lines = [header.join(','), ...events.map((e) => [
      e.id, e.createdAt, e.eventType, e.userId, e.resourceType, e.resourceId, e.metadata,
    ].map(csvCell).join(','))];
    downloadText(lines.join('\n'), `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  const from = events.length ? offset + 1 : 0;
  const to = offset + events.length;

  return (
    <RoleGate capability="insights.compliance" variant="block">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{t('auditLog.title')}</div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 4 }}>{t('auditLog.subtitle')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <input
              style={input}
              value={eventTypeDraft}
              onChange={(e) => setEventTypeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder={t('auditLog.filterEventType')}
              aria-label={t('auditLog.filterEventType')}
            />
            <input
              style={input}
              value={resourceTypeDraft}
              onChange={(e) => setResourceTypeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder={t('auditLog.filterResourceType')}
              aria-label={t('auditLog.filterResourceType')}
            />
            <button type="button" style={btn('primary')} disabled={busy} onClick={applyFilters}>{t('auditLog.apply')}</button>
            <button type="button" style={btn('ghost')} disabled={busy || events.length === 0} onClick={exportCsv}>{t('auditLog.export')}</button>
          </div>
          {error && (
            <div role="alert" style={{ marginTop: 10, fontSize: 'var(--font-size-small)', color: 'var(--error)' }}>{error}</div>
          )}
        </div>

        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          {busy && events.length === 0 ? (
            <div style={{ padding: 16, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('auditLog.loading')}</div>
          ) : events.length === 0 ? (
            <div style={{ padding: 16, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('auditLog.empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>{t('auditLog.colWhen')}</th>
                  <th style={th}>{t('auditLog.colEvent')}</th>
                  <th style={th}>{t('auditLog.colActor')}</th>
                  <th style={th}>{t('auditLog.colResource')}</th>
                  <th style={th}>{t('auditLog.colDetails')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt.dateTime(e.createdAt)}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{e.eventType}</td>
                    <td style={td}>{e.userId ?? t('auditLog.system')}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                      {e.resourceType ? `${e.resourceType}${e.resourceId ? ` #${e.resourceId}` : ''}` : '—'}
                    </td>
                    <td style={{ ...td, color: 'var(--text-secondary)', maxWidth: 360, overflowWrap: 'anywhere' }}>{e.metadata ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('auditLog.page', { from, to })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={btn('ghost')} disabled={busy || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('auditLog.newer')}</button>
            <button type="button" style={btn('ghost')} disabled={busy || events.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}>{t('auditLog.older')}</button>
          </div>
        </div>
      </div>
    </RoleGate>
  );
}
