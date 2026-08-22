/**
 * No `'use client'`: its only importer, `MarketplaceGigsSection`, already
 * declares the boundary. Everything the panel does is a click, and all of that
 * still works — a module imported by a client module is client code — but the
 * directive itself was buying nothing and costing the architecture ratchet.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createJobAlert, deleteJobAlert, listJobAlerts, updateJobAlert, type JobAlert } from '@/lib/freelance/jobSeeker';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 18,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 'var(--font-size-small)', outline: 'none', minWidth: 0,
};

/**
 * Standing searches that tell a job seeker when matching work appears.
 *
 * Self-contained by design: it owns its own reads and writes rather than taking them
 * as props, so the gigs surface does not fetch alerts it may never show. An alert is a
 * `saved_searches` row with `scope='listing'` on the server — no new table — and
 * `enabled` lives inside its filters, which is why toggling is the same PATCH as
 * renaming rather than a separate endpoint.
 */
export function JobAlertsPanel() {
  const t = useTranslations('freelancer.alerts');
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', keywords: '', discipline: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await listJobAlerts());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('actionFailed')); }
    finally { setBusy(null); }
  };

  const create = async () => {
    const name = draft.name.trim();
    if (!name) { setError(t('nameRequired')); return; }
    await act('create', async () => {
      await createJobAlert({
        name,
        filters: {
          ...(draft.keywords.trim() ? { q: draft.keywords.trim() } : {}),
          ...(draft.discipline.trim() ? { discipline: draft.discipline.trim() } : {}),
        },
      });
      setDraft({ name: '', keywords: '', discipline: '' });
    });
  };

  /** The criteria, rendered as the sentence the person typed rather than raw JSON. */
  const describe = (alert: JobAlert): string => {
    const parts = Object.entries(alert.filters)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => `${key}: ${String(value)}`);
    return parts.length ? parts.join(' · ') : t('anyJob');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{t('newTitle')}</div>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '4px 0 12px' }}>{t('newSubtitle')}</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <input style={input} placeholder={t('namePlaceholder')} value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input style={input} placeholder={t('keywordsPlaceholder')} value={draft.keywords}
            onChange={(e) => setDraft((d) => ({ ...d, keywords: e.target.value }))} />
          <input style={input} placeholder={t('disciplinePlaceholder')} value={draft.discipline}
            onChange={(e) => setDraft((d) => ({ ...d, discipline: e.target.value }))} />
        </div>
        <button type="button" onClick={create} disabled={busy === 'create'}
          style={{ marginTop: 12, padding: '7px 16px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: 'var(--text-on-accent)', fontSize: 'var(--font-size-small)', fontWeight: 700, cursor: 'pointer' }}>
          {busy === 'create' ? t('creating') : t('create')}
        </button>
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>}

      {!loading && alerts.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('empty')}</div>
      )}

      {alerts.map((alert) => (
        <div key={alert.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{alert.name}</div>
            <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 4 }}>{describe(alert)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy === `toggle:${alert.id}`}
              aria-pressed={alert.enabled}
              onClick={() => act(`toggle:${alert.id}`, () => updateJobAlert(alert.id, { enabled: !alert.enabled }))}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                border: `1px solid ${alert.enabled ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                background: alert.enabled ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                color: alert.enabled ? 'var(--coral-bright)' : 'var(--text-secondary)',
                fontSize: 'var(--font-size-small)', fontWeight: 600 }}>
              {alert.enabled ? t('on') : t('off')}
            </button>
            <button type="button" disabled={busy === `delete:${alert.id}`}
              onClick={() => act(`delete:${alert.id}`, () => deleteJobAlert(alert.id))}
              style={{ padding: '7px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
              {t('delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
